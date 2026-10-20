package space.sirok.gitlabcigraph.parser

import org.yaml.snakeyaml.DumperOptions
import org.yaml.snakeyaml.nodes.MappingNode
import org.yaml.snakeyaml.nodes.Node
import org.yaml.snakeyaml.nodes.NodeTuple
import org.yaml.snakeyaml.nodes.ScalarNode

internal data class LocalJobDefinition(val fields: Map<String, Node>, val file: String, val line: Int)
internal data class ResolvedLocalJob(
    val fields: Map<String, Node>,
    val ancestors: List<String> = emptyList(),
    val unresolved: List<String> = emptyList(),
    val stageOwner: String? = null,
    val depth: Int = 0,
)

/** Bounded local extends expansion. Rules, external includes and !reference remain unresolved. */
internal class LocalJobResolver(
    private val definitions: Map<String, LocalJobDefinition>,
    private val warn: (String) -> Unit,
) {
    private val cache = mutableMapOf<String, ResolvedLocalJob>()

    fun resolve(name: String): ResolvedLocalJob = resolve(name, emptyList())

    private fun resolve(name: String, path: List<String>): ResolvedLocalJob {
        if (name in path) {
            warn("Extends cycle: ${(path + name).joinToString(" -> ")}")
            return ResolvedLocalJob(emptyMap(), unresolved = listOf(name))
        }
        if (path.size > 11) {
            warn("$name: extends exceeds 11 inheritance levels")
            return ResolvedLocalJob(emptyMap(), unresolved = listOf(name))
        }
        cache[name]?.let {
            if (path.size + it.depth <= 11) return it
            warn("$name: extends exceeds 11 inheritance levels")
            return ResolvedLocalJob(emptyMap(), unresolved = listOf(name))
        }
        val definition = definitions[name] ?: run {
            warn("${path.lastOrNull() ?: name}: extends template '$name' is unavailable locally. Use GitLab mode to resolve external templates.")
            return ResolvedLocalJob(emptyMap(), unresolved = listOf(name))
        }
        var fields = emptyMap<String, Node>()
        val ancestors = linkedSetOf<String>()
        val unresolved = linkedSetOf<String>()
        var stageOwner: String? = null
        var depth = 0
        LocalPipelineParser.strings(definition.fields["extends"]).forEach { parent ->
            val inherited = resolve(parent, path + name)
            depth = maxOf(depth, inherited.depth + 1)
            ancestors.addAll(inherited.ancestors)
            ancestors.add(parent)
            unresolved.addAll(inherited.unresolved)
            fields = mergeFields(fields, inherited.fields)
            if ("stage" in inherited.fields) stageOwner = inherited.stageOwner
        }
        fields = mergeFields(fields, definition.fields)
        if ("stage" in definition.fields) stageOwner = name
        return ResolvedLocalJob(fields, ancestors.toList(), unresolved.toList(), stageOwner, depth).also {
            // Cache only complete results: diagnostics/limits depend on the current ancestry path.
            if (it.unresolved.isEmpty()) cache[name] = it
        }
    }

    companion object {
        fun mergeFields(base: Map<String, Node>, override: Map<String, Node>): Map<String, Node> =
            (base.keys + override.keys).associateWith { key ->
                val right = override[key]
                if (right == null) base.getValue(key) else mergeNode(base[key], right, 0)
            }

        private fun mergeNode(left: Node?, right: Node, depth: Int): Node {
            // Arrays and explicit null replace the inherited value; only mappings merge.
            if (left !is MappingNode || right !is MappingNode || left === right || depth >= 64) return right
            val tuples = linkedMapOf<String, NodeTuple>()
            left.value.forEach { tuples[(it.keyNode as ScalarNode).value] = it }
            right.value.forEach { tuple ->
                val key = (tuple.keyNode as ScalarNode).value
                tuples[key] = NodeTuple(tuple.keyNode, mergeNode(tuples[key]?.valueNode, tuple.valueNode, depth + 1))
            }
            return MappingNode(right.tag, tuples.values.toList(), DumperOptions.FlowStyle.BLOCK)
        }
    }
}
