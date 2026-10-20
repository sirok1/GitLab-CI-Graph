package space.sirok.gitlabcigraph.jcef

import org.junit.Assert.*
import org.junit.Test
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.util.Base64
import javax.imageio.ImageIO

class WorkspaceScreenshotTest {
    @Test fun `decode preserves image size and pixels`() {
        val image = BufferedImage(32, 24, BufferedImage.TYPE_INT_ARGB)
        image.setRGB(5, 6, 0xff336699.toInt())
        val output = ByteArrayOutputStream()
        ImageIO.write(image, "png", output)
        val decoded = WorkspaceScreenshot.decode("data:image/png;base64," + Base64.getEncoder().encodeToString(output.toByteArray()))
        assertEquals(32, decoded.width)
        assertEquals(24, decoded.height)
        assertEquals(image.getRGB(5, 6), decoded.getRGB(5, 6))
    }

    @Test fun `reject invalid screenshot payloads`() {
        for (data in listOf(null, "", "data:image/jpeg;base64,abcd", "data:image/png;base64,not-an-image")) {
            assertTrue(runCatching { WorkspaceScreenshot.decode(data) }.isFailure)
        }
    }
}
