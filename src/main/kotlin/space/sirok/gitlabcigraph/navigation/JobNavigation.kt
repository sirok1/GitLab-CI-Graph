package space.sirok.gitlabcigraph.navigation

import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import space.sirok.gitlabcigraph.model.PipelineJob
import java.nio.file.Path

object JobNavigation {
    fun navigate(project: Project, job: PipelineJob) {
        val base = Path.of(project.basePath ?: return).toAbsolutePath().normalize()
        val path = base.resolve(job.sourceFile ?: return).normalize()
        if (!path.startsWith(base)) return
        val file = LocalFileSystem.getInstance().findFileByNioFile(path) ?: return
        OpenFileDescriptor(project, file, ((job.sourceLine ?: 1) - 1).coerceAtLeast(0), 0).navigate(true)
    }
}
