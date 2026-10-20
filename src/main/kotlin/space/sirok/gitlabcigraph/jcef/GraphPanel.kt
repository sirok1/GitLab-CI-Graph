package space.sirok.gitlabcigraph.jcef

import com.google.gson.Gson
import com.intellij.ide.BrowserUtil
import com.intellij.ide.ui.LafManager
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.ui.UIUtil
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import space.sirok.gitlabcigraph.gitlab.GitLabClient
import space.sirok.gitlabcigraph.model.*
import space.sirok.gitlabcigraph.navigation.JobNavigation
import space.sirok.gitlabcigraph.parser.LocalPipelineParser
import space.sirok.gitlabcigraph.parser.IdePipelineFiles
import space.sirok.gitlabcigraph.settings.*
import java.awt.BorderLayout
import java.nio.file.*
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicLong
import javax.swing.JPanel

data class BridgeMessage(val type: String = "", val job: String? = null, val file: String? = null, val mode: String? = null, val ref: String? = null)
data class ViewState(val pipeline: PipelineModel?, val configs: List<String>, val selectedFile: String, val dark: Boolean, val loading: Boolean = false, val error: String? = null, val gitLabConfigured: Boolean = false, val defaultRef: String = "main")

class GraphPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {
    private val browser = JBCefBrowser()
    private val query = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val gson = Gson()
    private val executor = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "GitLab CI Graph").apply { isDaemon = true } }
    private val generation = AtomicLong()
    @Volatile private var disposed = false
    @Volatile private var model: PipelineModel? = null
    @Volatile private var configs = emptyList<String>()
    private var mode = "LOCAL"
    private var ref = GraphSettings.get(project).state.ref
    private var pending: ScheduledFuture<*>? = null
    private val log = Logger.getInstance(GraphPanel::class.java)
    private val pipelineFiles = IdePipelineFiles(Path.of(project.basePath ?: "."), this) { refresh(400) }
    init {
        Disposer.register(this, browser)
        Disposer.register(this, query)
        add(browser.component, BorderLayout.CENTER)
        query.addHandler { text ->
            val message = runCatching { gson.fromJson(text, BridgeMessage::class.java) }.getOrNull()
            if (message != null) ApplicationManager.getApplication().invokeLater { if (!disposed && !project.isDisposed) handle(message) }
            null
        }
        browser.jbCefClient.cefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser?, frame: CefFrame?, status: Int) {
                if (frame?.isMain == true && !disposed) {
                    browser.cefBrowser.executeJavaScript("window.ideSend=function(message){${query.inject("JSON.stringify(message)")}};window.dispatchEvent(new Event('ide-ready'));", browser.cefBrowser.url, 0)
                    ApplicationManager.getApplication().invokeLater { if (!disposed) refresh() }
                }
            }
        })
        ApplicationManager.getApplication().messageBus.connect(this).subscribe(LafManagerListener.TOPIC, LafManagerListener { _: LafManager -> publish() })
        val html = javaClass.getResourceAsStream("/web/index.html")?.bufferedReader()?.use { it.readText() }
            ?: "<p>Frontend resources missing. Rebuild with Gradle buildPlugin.</p>"
        browser.loadHTML(html)
    }
    private fun handle(message: BridgeMessage) {
        when (message.type) {
            "graph:refresh" -> refresh()
            "source:change" -> {
                message.file?.takeIf { it in configs }?.let { GraphSettings.get(project).state.selectedFile = it }
                message.mode?.takeIf { it in listOf("LOCAL", "GITLAB") }?.let { mode = it }
                message.ref?.let { ref = it }
                refresh()
            }
            "job:navigate" -> model?.jobs?.find { it.id == message.job }?.let { JobNavigation.navigate(project, it) }
            "settings:open" -> { ShowSettingsUtil.getInstance().showSettingsDialog(project, GraphConfigurable::class.java); ref = GraphSettings.get(project).state.ref; refresh() }
            "project:open" -> {
                val s = GraphSettings.get(project).state
                if (s.url.startsWith("https://") || s.url.startsWith("http://")) BrowserUtil.browse("${s.url.trimEnd('/')}/${s.project}")
            }
            "file:select" -> FileChooser.chooseFile(FileChooserDescriptor(true, false, false, false, false, false), project, null)?.let { file ->
                val base = Path.of(project.basePath ?: return)
                val path = file.toNioPath()
                if (path.startsWith(base)) { GraphSettings.get(project).state.selectedFile = base.relativize(path).toString().replace('\\', '/'); refresh() }
            }
        }
    }
    @Synchronized private fun refresh(delay: Long = 0) {
        if (disposed || project.isDisposed) return
        val current = generation.incrementAndGet()
        pending?.cancel(true)
        val selectedMode = mode
        val selectedRef = ref
        val settings = GraphSettings.get(project).state.copy()
        pending = executor.schedule({
            try {
                ApplicationManager.getApplication().invokeLater {
                    if (!disposed && current == generation.get()) publish(loading = true)
                }
                val base = Path.of(project.basePath ?: throw IllegalStateException("Open a local project first"))
                val discovered = mutableListOf<String>()
                Files.walkFileTree(base, object : SimpleFileVisitor<Path>() {
                    override fun preVisitDirectory(dir: Path, attrs: java.nio.file.attribute.BasicFileAttributes): FileVisitResult =
                        if (dir != base && dir.fileName.toString() in setOf("node_modules", ".git", "build", ".idea", ".gradle", ".intellijPlatform")) FileVisitResult.SKIP_SUBTREE else FileVisitResult.CONTINUE
                    override fun visitFile(file: Path, attrs: java.nio.file.attribute.BasicFileAttributes): FileVisitResult {
                        if (file.fileName.toString() in listOf(".gitlab-ci.yml", ".gitlab-ci.yaml")) discovered += base.relativize(file).toString().replace('\\', '/')
                        return FileVisitResult.CONTINUE
                    }
                    override fun visitFileFailed(file: Path, exc: java.io.IOException) = FileVisitResult.CONTINUE
                })
                discovered.sortWith(compareBy<String> { it.count { ch -> ch == '/' } }.thenBy { it })
                val selected = settings.selectedFile.takeIf { it.isNotBlank() && Files.isRegularFile(base.resolve(it)) } ?: discovered.firstOrNull()
                val all = (discovered + listOfNotNull(selected)).distinct()
                var pipeline = selected?.let { LocalPipelineParser(pipelineFiles::readText).parse(base, base.resolve(it)) }
                if (pipeline != null && selectedMode == "GITLAB") {
                    if (settings.url.isBlank()) throw IllegalStateException("Configure GitLab URL and project in Settings")
                    val local = pipeline
                    pipeline = GitLabClient().use { it.resolve(settings.url, settings.project, TokenStore.get(settings.url, settings.project), selectedRef, pipelineFiles.readText(base.resolve(selected)), local) }
                }
                val result = pipeline
                ApplicationManager.getApplication().invokeLater {
                    if (!disposed && current == generation.get()) {
                        configs = all; model = result
                        if (selected != null) GraphSettings.get(project).state.selectedFile = selected
                        result?.let { log.info("Loaded ${it.source.mode} pipeline: ${it.jobs.size} jobs, ${it.stages.size} stages, ${it.edges.size} edges") }
                        publish()
                    }
                }
            } catch (e: Exception) {
                // Never log request headers, tokens, or YAML contents.
                val error = e.message ?: "Pipeline cannot be loaded"
                ApplicationManager.getApplication().invokeLater { if (!disposed && current == generation.get()) { model = null; publish(error = error) } }
            }
        }, delay, TimeUnit.MILLISECONDS)
    }
    private fun publish(loading: Boolean = false, error: String? = null) {
        if (disposed) return
        val background = UIUtil.getPanelBackground()
        val dark = background.red * 299 + background.green * 587 + background.blue * 114 < 128000
        val settings = GraphSettings.get(project).state
        val payload = gson.toJson(ViewState(model, configs, settings.selectedFile, dark, loading, error, settings.url.isNotBlank() && settings.project.isNotBlank(), settings.ref))
        browser.cefBrowser.executeJavaScript("window.dispatchEvent(new CustomEvent('pipeline:update',{detail:$payload}));", browser.cefBrowser.url, 0)
    }
    override fun dispose() { disposed = true; generation.incrementAndGet(); pending?.cancel(true); executor.shutdownNow() }
}
