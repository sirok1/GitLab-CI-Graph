package space.sirok.gitlabcigraph.parser

import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.testFramework.LightPlatformTestCase
import java.nio.file.Files

class IdePipelineFilesTest : LightPlatformTestCase() {
    fun testEditorChangesRefreshAndReadUnsavedMainAndInclude() {
        val root = Files.createTempDirectory("ci-graph-editor")
        val lifetime = Disposer.newDisposable()
        try {
            val main = root.resolve(".gitlab-ci.yml")
            val include = root.resolve("jobs.yml")
            val saved = "include: jobs.yml\nmain:\n  script: echo main\n"
            Files.writeString(main, saved)
            Files.writeString(include, "included:\n  script: echo included\n")
            val fs = LocalFileSystem.getInstance()
            val documents = FileDocumentManager.getInstance()
            val mainDocument = documents.getDocument(fs.refreshAndFindFileByNioFile(main)!!)!!
            val includeDocument = documents.getDocument(fs.refreshAndFindFileByNioFile(include)!!)!!
            var refreshes = 0
            val source = IdePipelineFiles(root, lifetime) { refreshes++ }
            WriteCommandAction.runWriteCommandAction(project) {
                mainDocument.insertString(mainDocument.textLength, "new-main:\n  script: echo new\n")
                includeDocument.insertString(includeDocument.textLength, "new-include:\n  script: echo new\n")
            }
            assertEquals(2, refreshes)
            val pipeline = LocalPipelineParser(source::readText).parse(root, main)
            assertTrue(pipeline.errors.toString(), pipeline.valid)
            assertEquals(setOf("main", "included", "new-main", "new-include"), pipeline.jobs.map { it.name }.toSet())
            assertEquals(saved, Files.readString(main))
            assertFalse(Files.readString(include).contains("new-include"))
            Disposer.dispose(lifetime)
            WriteCommandAction.runWriteCommandAction(project) { mainDocument.insertString(mainDocument.textLength, "# after dispose\n") }
            assertEquals(2, refreshes)
            WriteCommandAction.runWriteCommandAction(project) {
                mainDocument.setText(saved)
                includeDocument.setText(Files.readString(include))
            }
        } finally {
            Disposer.dispose(lifetime)
            root.toFile().deleteRecursively()
        }
    }
}
