package space.sirok.gitlabcigraph.parser

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import java.nio.file.Files
import java.nio.file.Path

/** Observes editor buffers and disk changes without saving documents or parsing on the EDT. */
class IdePipelineFiles(root: Path, disposable: Disposable, onChange: () -> Unit) {
    private val base = root.toAbsolutePath().normalize()

    init {
        EditorFactory.getInstance().eventMulticaster.addDocumentListener(object : DocumentListener {
            override fun documentChanged(event: DocumentEvent) {
                val file = FileDocumentManager.getInstance().getFile(event.document) ?: return
                if (isProjectYaml(file.path)) onChange()
            }
        }, disposable)
        ApplicationManager.getApplication().messageBus.connect(disposable)
            .subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
                override fun after(events: List<VFileEvent>) {
                    if (events.any { isProjectYaml(it.path) }) onChange()
                }
            })
    }

    private fun isProjectYaml(path: String): Boolean {
        if (!path.endsWith(".yml") && !path.endsWith(".yaml")) return false
        val file = Path.of(path).toAbsolutePath().normalize()
        return file.startsWith(base) && base.relativize(file).none {
            it.toString() in setOf("node_modules", ".git", "build", ".idea", ".gradle", ".intellijPlatform")
        }
    }

    fun readText(path: Path): String {
        val text = ReadAction.compute<String?, RuntimeException> {
            val file = LocalFileSystem.getInstance().findFileByNioFile(path)
            file?.let { FileDocumentManager.getInstance().getCachedDocument(it)?.immutableCharSequence?.toString() }
        }
        return text ?: Files.readString(path)
    }
}
