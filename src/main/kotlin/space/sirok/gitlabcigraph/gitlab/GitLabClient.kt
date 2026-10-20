package space.sirok.gitlabcigraph.gitlab

import com.google.gson.*
import space.sirok.gitlabcigraph.model.*
import space.sirok.gitlabcigraph.parser.LocalPipelineParser
import java.net.URI
import java.net.URLEncoder
import java.net.http.*
import java.time.Duration

class GitLabException(message: String) : RuntimeException(message)
class GitLabClient(private val timeout: Duration = Duration.ofSeconds(30)) : AutoCloseable {
    private val gson = Gson()
    private val http = HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build()
    override fun close() { http.close() }
    fun testConnection(url: String, project: String, token: String) { request(url, project, token, null) }
    fun resolve(url: String, project: String, token: String, ref: String, content: String, local: PipelineModel): PipelineModel {
        val payload = gson.toJson(mapOf("content" to content, "dry_run" to true, "include_jobs" to true, "ref" to ref))
        val data = request(url, project, token, payload)
        fun messages(key: String) = data.getAsJsonArray(key)?.map { if (it.isJsonPrimitive) it.asString else it.toString() } ?: emptyList()
        val errors = messages("errors")
        val warnings = messages("warnings").map(::PipelineWarning).toMutableList()
        val merged = data.get("merged_yaml")?.takeUnless { it.isJsonNull }?.asString?.let {
            runCatching {
                val node = org.yaml.snakeyaml.Yaml().compose(it.reader())
                LocalPipelineParser.mapping(node)
            }.getOrDefault(emptyMap())
        } ?: emptyMap()
        val valid = data.get("valid")?.asBoolean ?: false
        val apiJobs = data.getAsJsonArray("jobs")
        if (valid && apiJobs == null) throw GitLabException("GitLab did not return resolved jobs. Check server support for include_jobs and dry_run.")
        val jobs = apiJobs?.map { element ->
            val j = element.asJsonObject
            val name = j["name"].asString
            val original = local.jobs.find { it.name == name }
            val extra = LocalPipelineParser.job(name, LocalPipelineParser.mapping(merged[name]))
            fun str(key: String) = j[key]?.takeUnless { it.isJsonNull }?.let { if (it.isJsonPrimitive) it.asString else it.asJsonObject["name"]?.asString }
            val needs = j.getAsJsonArray("needs")?.mapNotNull { n ->
                if (n.isJsonPrimitive) JobNeed(n.asString) else {
                    val o = n.asJsonObject
                    (o["name"] ?: o["job"])?.asString?.let { JobNeed(it, o["artifacts"]?.takeUnless { it.isJsonNull }?.asBoolean, o["optional"]?.asBoolean ?: false, o["project"]?.asString, o["pipeline"]?.asString) }
                }
            } ?: emptyList()
            extra.copy(stage = str("stage") ?: extra.stage, needs = needs, whenType = str("when") ?: extra.whenType,
                allowFailure = j["allow_failure"]?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean ?: extra.allowFailure,
                environment = str("environment") ?: extra.environment, sourceFile = original?.sourceFile, sourceLine = original?.sourceLine,
                extends = original?.extends?.takeIf { it.isNotEmpty() } ?: extra.extends,
                inheritanceChain = original?.inheritanceChain ?: emptyList(),
                stageInheritedFrom = original?.takeIf { it.stage == (str("stage") ?: extra.stage) }?.stageInheritedFrom)
        } ?: emptyList()
        if (jobs.any { it.sourceFile == null }) warnings += PipelineWarning("Some resolved jobs have no exact local definition; navigation is unavailable for them.")
        val declared = LocalPipelineParser.strings(merged["stages"]).ifEmpty { local.stages.map { it.name } }
        val stageNames = (declared + jobs.map { it.stage }).distinct().toMutableList()
        if (stageNames.remove(".pre")) stageNames.add(0, ".pre")
        if (stageNames.remove(".post")) stageNames.add(".post")
        val stages = stageNames.map(::PipelineStage)
        return PipelineModel(PipelineSource("GITLAB", local.source.file, ref), stages, jobs, pipelineEdges(jobs), warnings, errors, valid, if (valid) "VALID" else "INVALID", local.files)
    }
    private fun request(url: String, project: String, token: String, body: String?): JsonObject {
        val uri = runCatching { URI(url.trimEnd('/')) }.getOrElse { throw GitLabException("Invalid GitLab URL") }
        if (uri.scheme !in listOf("https", "http") || uri.host == null || uri.userInfo != null || uri.query != null || uri.fragment != null) throw GitLabException("Enter an HTTP(S) GitLab instance URL without credentials or query parameters")
        if (project.isBlank()) throw GitLabException("Configure the GitLab project in Settings")
        if (token.any { it.code < 32 || it.code >= 127 }) throw GitLabException("Token contains unsupported characters. Re-enter the token in Settings.")
        val endpoint = "${url.trimEnd('/')}/api/v4/projects/${URLEncoder.encode(project, Charsets.UTF_8).replace("+", "%20")}" + if (body != null) "/ci/lint" else ""
        val builder = HttpRequest.newBuilder(URI(endpoint)).timeout(timeout).header("Accept", "application/json")
        if (token.isNotBlank()) builder.header("PRIVATE-TOKEN", token)
        if (body != null) builder.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body)) else builder.GET()
        val response = try { http.send(builder.build(), HttpResponse.BodyHandlers.ofString()) }
        catch (_: HttpTimeoutException) { throw GitLabException("GitLab request timed out") }
        catch (_: javax.net.ssl.SSLException) { throw GitLabException("GitLab TLS certificate could not be verified. Check the server certificate and JVM trust store.") }
        catch (_: java.io.IOException) { throw GitLabException("GitLab is unavailable. Check the URL and network connection.") }
        if (response.statusCode() !in 200..299) {
            val detail = runCatching {
                val data = JsonParser.parseString(response.body()).asJsonObject
                val errors = data["errors"] ?: data["message"]
                when { errors == null -> ""; errors.isJsonArray -> errors.asJsonArray.joinToString("\n") { if (it.isJsonPrimitive) it.asString else it.toString() }; errors.isJsonPrimitive -> errors.asString; else -> "" }.take(4000)
            }.getOrDefault("")
            throw GitLabException((when (response.statusCode()) {
            401 -> "GitLab 401: authentication failed. Check the token."
            403 -> "GitLab 403: access denied. Check project access and token permissions."
            404 -> "GitLab 404: project or endpoint not found."
            429 -> "GitLab rate limit reached. Retry later."
            400, 422 -> "GitLab rejected CI configuration or ref. Check the selected branch and YAML."
            else -> "GitLab returned HTTP ${response.statusCode()}"
            }) + if (detail.isNotBlank()) "\nGitLab returned:\n$detail" else "")
        }
        return runCatching { JsonParser.parseString(response.body()).asJsonObject }.getOrElse { throw GitLabException("GitLab returned an invalid JSON response") }
    }
}
