package space.sirok.gitlabcigraph.toolwindow

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import space.sirok.gitlabcigraph.jcef.GraphPanel
import javax.swing.JLabel

class GraphToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = if (JBCefApp.isSupported()) GraphPanel(project) else javax.swing.JPanel().apply {
            add(JLabel("GitLab CI Graph requires JCEF, but JCEF is unavailable in this IDE runtime."))
        }
        val content = ContentFactory.getInstance().createContent(panel, "", false)
        if (panel is GraphPanel) content.setDisposer(panel)
        toolWindow.contentManager.addContent(content)
    }
}
