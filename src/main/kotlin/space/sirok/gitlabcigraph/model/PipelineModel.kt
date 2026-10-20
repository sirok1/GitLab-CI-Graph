package space.sirok.gitlabcigraph.model

data class PipelineSource(val mode: String = "LOCAL", val file: String? = null, val ref: String? = null)
data class PipelineStage(val name: String)
data class JobNeed(val job: String, val artifacts: Boolean? = null, val optional: Boolean = false, val project: String? = null, val pipeline: String? = null)
data class TriggerInfo(val description: String)
data class PipelineJob(
    val id: String, val name: String, val stage: String = "test",
    val needs: List<JobNeed> = emptyList(), val dependencies: List<String> = emptyList(),
    val whenType: String? = null, val allowFailure: Boolean? = null,
    val environment: String? = null, val hasArtifacts: Boolean = false,
    val trigger: TriggerInfo? = null, val sourceFile: String? = null, val sourceLine: Int? = null,
    val extends: List<String> = emptyList(), val rulesCount: Int = 0, val image: String? = null,
    val hasExplicitNeeds: Boolean = false,
    val inheritanceChain: List<String> = emptyList(),
    val unresolvedExtends: List<String> = emptyList(),
    val stageInheritedFrom: String? = null,
)
data class PipelineEdge(val source: String, val target: String, val artifacts: Boolean?, val optional: Boolean)
data class PipelineWarning(val message: String)
data class PipelineModel(
    val source: PipelineSource = PipelineSource(), val stages: List<PipelineStage> = emptyList(),
    val jobs: List<PipelineJob> = emptyList(), val edges: List<PipelineEdge> = emptyList(),
    val warnings: List<PipelineWarning> = emptyList(), val errors: List<String> = emptyList(),
    val valid: Boolean = true, val validation: String = "STRUCTURE ONLY",
    val files: List<String> = emptyList(),
)

fun pipelineEdges(jobs: List<PipelineJob>) = jobs.flatMap { target ->
    target.needs.filter { need -> need.project == null && need.pipeline == null && jobs.any { it.name == need.job } }
        .map { PipelineEdge(it.job, target.id, it.artifacts, it.optional) }
}
