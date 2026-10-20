package space.sirok.gitlabcigraph.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.Project
import com.intellij.ui.components.JBLabel
import space.sirok.gitlabcigraph.gitlab.GitLabClient
import java.awt.GridLayout
import javax.swing.*
import java.nio.file.Path
import java.nio.file.Files

class GraphConfigurable(private val project: Project) : Configurable {
    private val url = JTextField()
    private val path = JTextField()
    private val ref = JTextField()
    private val token = JPasswordField()
    private val status = JBLabel()
    private val clearToken = JCheckBox("Remove saved token")
    private var tokenEdited = false
    private var resetting = false
    private var connectionTest: java.util.concurrent.Future<*>? = null
    @Volatile private var uiDisposed = false
    override fun getDisplayName() = "GitLab CI Graph"
    override fun createComponent(): JComponent {
        uiDisposed = false
        token.document.addDocumentListener(object : javax.swing.event.DocumentListener {
            override fun insertUpdate(e: javax.swing.event.DocumentEvent) { if (!resetting) tokenEdited = true }
            override fun removeUpdate(e: javax.swing.event.DocumentEvent) { if (!resetting) tokenEdited = true }
            override fun changedUpdate(e: javax.swing.event.DocumentEvent) = Unit
        })
        val test = JButton("Test connection")
        test.addActionListener {
            val u = url.text.trim(); val p = path.text.trim(); val entered = String(token.password); val edited = tokenEdited
            test.isEnabled = false; status.text = "Connecting…"
            connectionTest = ApplicationManager.getApplication().executeOnPooledThread {
                val result = runCatching { GitLabClient().use { it.testConnection(u, p, if (edited) entered else TokenStore.get(u, p)) } }
                ApplicationManager.getApplication().invokeLater {
                    if (!uiDisposed) { test.isEnabled = true; status.text = result.fold({ "Connected" }, { it.message ?: "Connection failed" }) }
                }
            }
        }
        val panel = JPanel(GridLayout(0, 2, 8, 8))
        listOf("GitLab URL" to url, "Project path or ID" to path, "Default ref" to ref, "Personal Access Token" to token).forEach { (label, field) -> panel.add(JBLabel(label)); panel.add(field) }
        val suggestion = detectRemote(project.basePath)
        if (suggestion != null) {
            panel.add(JBLabel("Remote suggestion: ${suggestion.first}/${suggestion.second}"))
            panel.add(JButton("Use suggestion").apply { addActionListener { url.text = suggestion.first; path.text = suggestion.second } })
        }
        panel.add(clearToken); panel.add(JBLabel("Tokens are stored in PasswordSafe"))
        panel.add(test); panel.add(status)
        reset()
        return JPanel(java.awt.BorderLayout()).apply { add(panel, java.awt.BorderLayout.NORTH) }
    }
    override fun isModified(): Boolean {
        val s = GraphSettings.get(project).state
        return s.url != url.text.trim() || s.project != path.text.trim() || s.ref != ref.text.trim() || tokenEdited || clearToken.isSelected
    }
    override fun apply() {
        val u = url.text.trim(); val p = path.text.trim(); val password = String(token.password); val changed = tokenEdited; val remove = clearToken.isSelected
        GraphSettings.get(project).state.apply { url = u; this.project = p; ref = this@GraphConfigurable.ref.text.trim() }
        if (changed || remove) com.intellij.openapi.progress.ProgressManager.getInstance().runProcessWithProgressSynchronously(
            Runnable { TokenStore.set(u, p, if (remove) "" else password) }, "Saving GitLab credentials", false, project)
        tokenEdited = false
        clearToken.isSelected = false
    }
    override fun reset() {
        val s = GraphSettings.get(project).state
        url.text = s.url; path.text = s.project; ref.text = s.ref
        resetting = true; token.text = ""; resetting = false; tokenEdited = false
        clearToken.isSelected = false
        token.toolTipText = "Leave unchanged to retain saved token; type a new token to replace it."
    }
    override fun disposeUIResources() { uiDisposed = true; connectionTest?.cancel(true); token.text = "" }
    companion object {
        fun detectRemote(base: String?): Pair<String, String>? = runCatching {
            val config = Path.of(base ?: return null, ".git", "config")
            if (!Files.isRegularFile(config)) return null
            val value = Files.readAllLines(config).firstOrNull { it.trim().startsWith("url =") }?.substringAfter('=')?.trim() ?: return null
            if (value.startsWith("git@")) {
                val host = value.substringAfter('@').substringBefore(':')
                "https://$host" to value.substringAfter(':').removeSuffix(".git")
            } else {
                val uri = java.net.URI(value)
                if (uri.scheme !in listOf("https", "http", "ssh")) return null
                "${if (uri.scheme == "ssh") "https" else uri.scheme}://${uri.host}${if (uri.port > 0) ":${uri.port}" else ""}" to uri.path.trim('/').removeSuffix(".git")
            }
        }.getOrNull()
    }
}
