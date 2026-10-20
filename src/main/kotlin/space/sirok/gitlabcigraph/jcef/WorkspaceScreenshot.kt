package space.sirok.gitlabcigraph.jcef

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.Transferable
import java.awt.datatransfer.UnsupportedFlavorException
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.util.Base64
import javax.imageio.ImageIO
import javax.swing.JFileChooser
import javax.swing.filechooser.FileNameExtensionFilter

/** Exports only the browser workspace supplied by the frontend, never the user's desktop. */
object WorkspaceScreenshot {
    fun export(project: Project, data: String?, save: Boolean, result: (String) -> Unit) {
        val chooser = if (save) JFileChooser().apply {
            dialogTitle = "Save GitLab CI Graph screenshot"
            fileFilter = FileNameExtensionFilter("PNG image", "png")
            selectedFile = java.io.File("gitlab-ci-graph.png")
        } else null
        if (chooser != null && chooser.showSaveDialog(null) != JFileChooser.APPROVE_OPTION) {
            result("Screenshot cancelled")
            return
        }
        val target = chooser?.selectedFile?.let {
            if (it.name.endsWith(".png", ignoreCase = true)) it else java.io.File(it.parentFile, "${it.name}.png")
        }
        if (target?.exists() == true && javax.swing.JOptionPane.showConfirmDialog(null,
                "Replace ${target.name}?", "Save screenshot", javax.swing.JOptionPane.YES_NO_OPTION) != javax.swing.JOptionPane.YES_OPTION) {
            result("Screenshot cancelled")
            return
        }
        val app = ApplicationManager.getApplication()
        app.executeOnPooledThread {
            val decoded = runCatching { decode(data) }
            val saved = if (target != null) decoded.mapCatching { image ->
                check(ImageIO.write(image, "png", target))
                image
            } else decoded
            app.invokeLater {
                if (!project.isDisposed) {
                    val message = saved.fold(onSuccess = { image ->
                        if (target != null) "Screenshot saved: ${target.name}" else {
                            runCatching { CopyPasteManager.getInstance().setContents(ImageTransferable(image)) }
                                .fold({ "Screenshot copied — paste it into your chat" }, { "Cannot access clipboard. Use Save PNG instead." })
                        }
                    }, onFailure = { "Cannot export screenshot. Try a smaller workspace." })
                    result(message)
                }
            }
        }
    }

    internal fun decode(data: String?): BufferedImage {
        require(data != null && data.startsWith("data:image/png;base64,") && data.length <= 24 * 1024 * 1024)
        val bytes = Base64.getDecoder().decode(data.substringAfter(','))
        ImageIO.createImageInputStream(ByteArrayInputStream(bytes)).use { input ->
            val readers = ImageIO.getImageReaders(input)
            require(readers.hasNext())
            val reader = readers.next()
            try {
                reader.input = input
                require(reader.formatName.equals("png", ignoreCase = true))
                require(reader.getWidth(0).toLong() * reader.getHeight(0) <= 40_000_000)
                return reader.read(0)
            } finally {
                reader.dispose()
            }
        }
    }

    private class ImageTransferable(private val image: BufferedImage) : Transferable {
        override fun getTransferDataFlavors() = arrayOf(DataFlavor.imageFlavor)
        override fun isDataFlavorSupported(flavor: DataFlavor) = flavor == DataFlavor.imageFlavor
        override fun getTransferData(flavor: DataFlavor): Any {
            if (!isDataFlavorSupported(flavor)) throw UnsupportedFlavorException(flavor)
            return image
        }
    }
}
