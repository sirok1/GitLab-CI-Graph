package space.sirok.gitlabcigraph.gitlab

import com.sun.net.httpserver.HttpServer
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test
import space.sirok.gitlabcigraph.model.PipelineModel
import java.net.InetSocketAddress
import java.time.Duration

class GitLabClientTest {
    private fun server(code: Int, body: String, delay: Long = 0, test: (String) -> Unit) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/v4/projects/") { exchange ->
            assertEquals("POST", exchange.requestMethod)
            val request = JsonParser.parseString(exchange.requestBody.bufferedReader().readText()).asJsonObject
            assertTrue(request["dry_run"].asBoolean); assertTrue(request["include_jobs"].asBoolean); assertEquals("main", request["ref"].asString)
            assertEquals("secret-test", exchange.requestHeaders.getFirst("PRIVATE-TOKEN"))
            if (delay > 0) Thread.sleep(delay)
            runCatching { val bytes = body.toByteArray(); exchange.sendResponseHeaders(code, bytes.size.toLong()); exchange.responseBody.use { it.write(bytes) } }
            exchange.close()
        }
        server.start()
        try { test("http://127.0.0.1:${server.address.port}") } finally { server.stop(0) }
    }
    private fun resolve(url: String, timeout: Duration = Duration.ofSeconds(3)) = GitLabClient(timeout).use { it.resolve(url, "123", "secret-test", "main", "job: {}", PipelineModel()) }
    @Test fun validJobsNeedsWarnings() = server(200, """{"valid":true,"errors":[],"warnings":["warning"],"jobs":[{"name":"build","stage":"build"},{"name":"test","stage":"test","when":"manual","allow_failure":true,"needs":[{"name":"build","artifacts":true,"optional":true}]}]}""") { url ->
        val p = resolve(url); assertTrue(p.valid); assertEquals(2, p.jobs.size); assertEquals(1, p.edges.size)
        assertTrue(p.edges.single().optional); assertEquals(true, p.edges.single().artifacts)
        assertTrue(p.warnings.any { it.message == "warning" }); assertEquals("GITLAB", p.source.mode)
    }
    @Test fun invalid() = server(200, """{"valid":false,"errors":["invalid ref"],"warnings":[]}""") { url ->
        val p = resolve(url); assertFalse(p.valid); assertEquals(listOf("invalid ref"), p.errors)
    }
    @Test fun unauthorized() = server(401, "{}") { url -> assertTrue(assertThrows(GitLabException::class.java) { resolve(url) }.message!!.contains("401")) }
    @Test fun missingProject() = server(404, "{}") { url -> assertTrue(assertThrows(GitLabException::class.java) { resolve(url) }.message!!.contains("404")) }
    @Test fun timeout() = server(200, "{}", 400) { url -> assertTrue(assertThrows(GitLabException::class.java) { resolve(url, Duration.ofMillis(80)) }.message!!.contains("timed out")) }
    @Test fun missingJobsNotReportedAsResolved() = server(200, """{"valid":true}""") { url -> assertThrows(GitLabException::class.java) { resolve(url) } }
    @Test fun validationResponseDetail() = server(422, """{"message":"jobs:test config should implement a script: or a trigger:"}""") { url ->
        assertTrue(assertThrows(GitLabException::class.java) { resolve(url) }.message!!.contains("jobs:test config"))
    }
    @Test fun mergedStagesAndEncodedProject() = server(200, """{"valid":true,"merged_yaml":"stages: [compile, verify, publish]\nship:\n  artifacts:\n    paths: [out]","jobs":[{"name":"ship","stage":"publish"}]}""") { url ->
        val p = GitLabClient().use { it.resolve(url, "group/subgroup/project", "secret-test", "main", "ship: {}", PipelineModel()) }
        assertEquals(listOf("compile", "verify", "publish"), p.stages.map { it.name }); assertTrue(p.jobs.single().hasArtifacts)
    }
    @Test fun invalidTokenHeaderDoesNotExposeToken() {
        val failure = GitLabClient().use { client -> assertThrows(GitLabException::class.java) { client.resolve("http://127.0.0.1", "123", "private-test-value\n", "main", "job: {}", PipelineModel()) } }
        assertFalse(failure.message!!.contains("private-test-value"))
        assertTrue(failure.message!!.contains("unsupported characters"))
    }
}
