package space.sirok.gitlabcigraph.parser

import org.yaml.snakeyaml.LoaderOptions
import org.yaml.snakeyaml.Yaml
import org.yaml.snakeyaml.nodes.*
import space.sirok.gitlabcigraph.model.*
import java.nio.file.Files
import java.nio.file.Path

/** Structural parser with bounded local extends expansion, without evaluating rules or remote includes. */
class LocalPipelineParser(private val readText: (Path) -> String = { Files.readString(it) }) {
    private val reserved = setOf("stages", "variables", "default", "workflow", "include", "image", "services", "before_script", "after_script", "cache", "pages", "spec", "types")

    fun parse(root: Path, entry: Path): PipelineModel {
        val base = root.toRealPath()
        val definitions = linkedMapOf<String, LocalJobDefinition>()
        val stages = linkedSetOf<String>()
        val warnings = mutableListOf(PipelineWarning("Local structure with local extends: rules, !reference and external includes are not resolved."))
        val errors = mutableListOf<String>()
        val visited = linkedSetOf<Path>()
        val active = mutableSetOf<Path>()
        fun read(path: Path) {
            val normalized = path.toAbsolutePath().normalize()
            if (!normalized.startsWith(base) || !Files.isRegularFile(normalized) || !normalized.toRealPath().startsWith(base)) {
                warnings += PipelineWarning("Local include unavailable or outside project: ${base.relativize(normalized)}")
                return
            }
            val real = normalized.toRealPath()
            if (real in active) { warnings += PipelineWarning("Include cycle: ${base.relativize(real)}"); return }
            if (!visited.add(real)) return
            if (visited.size > 200) { errors += "Too many included files (limit 200)"; return }
            active.add(real)
            try {
                val options = LoaderOptions().apply { codePointLimit = 3_000_000; nestingDepthLimit = 80; maxAliasesForCollections = 50 }
                val document = Yaml(options).compose(readText(real).reader())
                if (document !is MappingNode) { errors += "${base.relativize(real)}: expected YAML mapping"; return }
                val fields = mapping(document)
                fun include(node: Node?) {
                    when (node) {
                        is SequenceNode -> node.value.forEach { include(it) }
                        is ScalarNode -> {
                            val value = node.value
                            if (value.startsWith("http:") || value.startsWith("https:")) warnings += PipelineWarning("External include: $value. Use GitLab mode to resolve.")
                            else read(base.resolve(value.removePrefix("/")))
                        }
                        is MappingNode -> {
                            val config = mapping(node)
                            if (config.containsKey("rules")) warnings += PipelineWarning("Conditional local include shown without evaluating rules")
                            if (config["local"] != null) include(config["local"])
                            else warnings += PipelineWarning("External include (${config.keys.joinToString()}). Use GitLab mode to resolve.")
                        }
                        else -> Unit
                    }
                }
                include(fields["include"])
                val declaredStages = strings(fields["stages"])
                if (declaredStages.isNotEmpty()) { stages.clear(); stages.addAll(declaredStages) }
                document.value.forEach { tuple ->
                    val name = (tuple.keyNode as? ScalarNode)?.value ?: return@forEach
                    if (name in reserved || tuple.valueNode !is MappingNode) return@forEach
                    val f = mapping(tuple.valueNode)
                    val fields = definitions[name]?.let { LocalJobResolver.mergeFields(it.fields, f) } ?: f
                    definitions[name] = LocalJobDefinition(fields, base.relativize(real).toString().replace('\\', '/'), tuple.keyNode.startMark.line + 1)
                }
            } catch (e: Exception) {
                errors += "${base.relativize(real)}: ${e.message ?: "Invalid YAML"}"
            } finally { active.remove(real) }
        }
        read(entry)
        val resolutionWarnings = linkedSetOf<String>()
        val resolver = LocalJobResolver(definitions) { resolutionWarnings.add(it) }
        val jobs = linkedMapOf<String, PipelineJob>()
        definitions.filterKeys { !it.startsWith('.') }.forEach { (name, definition) ->
            val resolved = resolver.resolve(name)
            val parsed = job(name, resolved.fields, definition.file, definition.line)
            jobs[name] = parsed.copy(
                extends = strings(definition.fields["extends"]),
                inheritanceChain = resolved.ancestors,
                unresolvedExtends = resolved.unresolved,
                stageInheritedFrom = resolved.stageOwner?.takeUnless { it == name },
                stage = if ("stage" !in resolved.fields && resolved.unresolved.isNotEmpty()) "unresolved" else parsed.stage,
            )
        }
        warnings.addAll(resolutionWarnings.map(::PipelineWarning))
        if (stages.isEmpty()) stages.addAll(listOf("build", "test", "deploy"))
        val declaredStages = stages.toSet() + setOf(".pre", ".post", "unresolved")
        jobs.values.filter { it.stage !in declaredStages }.forEach {
            warnings += PipelineWarning("${it.name}: stage '${it.stage}' is not in stages. Shown as an extra column; GitLab may reject this configuration.")
        }
        if (jobs.values.any { it.stage == ".pre" }) { val rest = stages.toList(); stages.clear(); stages += ".pre"; stages.addAll(rest) }
        jobs.values.forEach { stages += it.stage }
        if (stages.remove(".post")) stages += ".post"
        jobs.values.forEach { j -> j.needs.filter { it.project == null && it.pipeline == null && it.job !in jobs && !it.optional }.forEach { warnings += PipelineWarning("${j.name}: unresolved need '${it.job}'") } }
        return PipelineModel(PipelineSource(file = base.relativize(entry.toAbsolutePath().normalize()).toString()), stages.map(::PipelineStage), jobs.values.toList(), pipelineEdges(jobs.values.toList()), warnings, errors, errors.isEmpty(), files = visited.map { base.relativize(it).toString().replace('\\', '/') })
    }

    companion object {
        fun mapping(node: Node?): Map<String, Node> = (node as? MappingNode)?.value?.associate { (it.keyNode as ScalarNode).value to it.valueNode } ?: emptyMap()
        fun scalar(node: Node?) = (node as? ScalarNode)?.takeUnless { it.tag == Tag.NULL }?.value
        fun strings(node: Node?): List<String> = when (node) { is ScalarNode -> scalar(node)?.let(::listOf) ?: emptyList(); is SequenceNode -> node.value.mapNotNull(::scalar); else -> emptyList() }
        fun job(name: String, f: Map<String, Node>, file: String? = null, line: Int? = null): PipelineJob {
            val needs = (f["needs"] as? SequenceNode)?.value?.mapNotNull { n ->
                if (n is ScalarNode) JobNeed(n.value) else {
                    val m = mapping(n)
                    scalar(m["job"])?.let { JobNeed(it, scalar(m["artifacts"])?.toBooleanStrictOrNull(), scalar(m["optional"]) == "true", scalar(m["project"]), scalar(m["pipeline"])) }
                }
            } ?: emptyList()
            fun named(key: String) = scalar(f[key]) ?: scalar(mapping(f[key])["name"])
            return PipelineJob(name, name, scalar(f["stage"]) ?: "test", needs, strings(f["dependencies"]), scalar(f["when"]), scalar(f["allow_failure"])?.toBooleanStrictOrNull(), named("environment"), f["artifacts"]?.let { it.tag != Tag.NULL } ?: false, f["trigger"]?.takeUnless { it.tag == Tag.NULL }?.let { TriggerInfo(scalar(it) ?: mapping(it).keys.joinToString()) }, file, line, strings(f["extends"]), (f["rules"] as? SequenceNode)?.value?.size ?: 0, named("image"), f.containsKey("needs"))
        }
    }
}
