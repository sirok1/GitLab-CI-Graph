package space.sirok.gitlabcigraph.parser

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path
import space.sirok.gitlabcigraph.model.PipelineModel

class LocalInheritanceTest {
    private fun parse(yaml: String, included: String? = null, assertions: (PipelineModel) -> Unit) {
        val root = Files.createTempDirectory("ci-graph-extends")
        try {
            val entry = root.resolve(".gitlab-ci.yml")
            Files.writeString(entry, yaml.trimIndent())
            if (included != null) Files.writeString(root.resolve("templates.yml"), included.trimIndent())
            assertions(LocalPipelineParser().parse(root, entry))
        } finally { root.toFile().deleteRecursively() }
    }

    @Test fun androidPublishStagesFromReportedExample() {
        val root = Path.of(javaClass.getResource("/fixtures/inheritance.yml")!!.toURI()).parent
        val pipeline = LocalPipelineParser().parse(root, root.resolve("inheritance.yml"))
        assertTrue(pipeline.errors.toString(), pipeline.valid)
        assertEquals(8, pipeline.jobs.size)
        for (name in listOf("publish Android dev", "publish Android stable")) {
            val job = pipeline.jobs.single { it.name == name }
            assertEquals("publish_android", job.stage)
            assertEquals(listOf(".publish Android release"), job.extends)
            assertEquals(".publish Android release", job.stageInheritedFrom)
            assertEquals("alpine:3.21", job.image)
            assertTrue(pipeline.edges.any { it.target == name && it.artifacts == true })
            assertEquals("inheritance.yml", job.sourceFile)
            assertTrue(job.sourceLine!! > 30)
        }
        assertEquals("test", pipeline.jobs.single { it.name == "lints" }.stage)
        assertFalse(pipeline.jobs.any { it.name.startsWith('.') })
        assertTrue(pipeline.warnings.any { "build_android_apk_dev" in it.message && "not in stages" in it.message })
        assertTrue(pipeline.warnings.any { "build_web_dev" in it.message && "not in stages" in it.message })
    }

    @Test fun multipleParentsNestedInheritanceAndChildOverrides() = parse("""
        stages: [build, test, deploy]
        prepare: {stage: build, script: echo prepare}
        .base:
          stage: build
          needs: [prepare]
          rules: [{when: manual}]
          artifacts: {paths: [out]}
          environment: {name: staging, url: https://example.invalid}
        .middle:
          extends: .base
          allow_failure: true
        .last:
          stage: deploy
          when: manual
          environment: {name: production}
        inherited:
          extends: .middle
        overridden:
          extends: [.middle, .last]
          stage: test
          needs: []
          rules: []
          environment: {url: https://other.invalid}
    """) { p ->
        assertTrue(p.errors.toString(), p.valid)
        val inherited = p.jobs.single { it.name == "inherited" }
        assertEquals("build", inherited.stage); assertEquals(".base", inherited.stageInheritedFrom)
        assertEquals(listOf(".base", ".middle"), inherited.inheritanceChain)
        assertEquals(true, inherited.allowFailure); assertEquals(1, inherited.rulesCount)
        assertTrue(inherited.hasArtifacts); assertEquals(listOf("prepare"), inherited.needs.map { it.job })
        val overridden = p.jobs.single { it.name == "overridden" }
        assertEquals("test", overridden.stage); assertNull(overridden.stageInheritedFrom)
        assertTrue(overridden.needs.isEmpty()); assertEquals(0, overridden.rulesCount)
        assertEquals("production", overridden.environment); assertEquals("manual", overridden.whenType)
        assertEquals(1, p.edges.size)
    }

    @Test fun lastParentWinsAndExplicitNullRemovesInheritedMetadata() = parse("""
        stages: [build, test, deploy]
        .first: {stage: build, artifacts: {paths: [out]}, trigger: child, environment: production}
        .second: {stage: deploy}
        job:
          extends: [.first, .second]
          artifacts: null
          trigger: null
          environment: null
    """) { p ->
        val job = p.jobs.single()
        assertEquals("deploy", job.stage); assertEquals(".second", job.stageInheritedFrom)
        assertFalse(job.hasArtifacts); assertNull(job.trigger); assertNull(job.environment)
    }

    @Test fun templatesFromLocalIncludeAndPartialJobOverrides() = parse("""
        include: {local: templates.yml}
        stages: [test, deploy]
        publish:
          extends: .release
          when: manual
    """, """
        .release: {stage: deploy, image: alpine}
        publish:
          image: node:22
          rules: [{when: always}]
    """) { p ->
        val job = p.jobs.single()
        assertEquals("deploy", job.stage); assertEquals("node:22", job.image)
        assertEquals(1, job.rulesCount); assertEquals("manual", job.whenType)
        assertEquals(".gitlab-ci.yml", job.sourceFile); assertEquals(3, job.sourceLine)
    }

    @Test fun cyclesAndMissingExternalParentsProduceDiagnostics() = parse("""
        .a: {extends: .b}
        .b: {extends: .a}
        cycle: {extends: .a}
        missing: {extends: .external}
        explicit: {extends: .external, stage: build}
    """) { p ->
        assertTrue(p.warnings.any { "Extends cycle" in it.message })
        assertTrue(p.warnings.any { ".external" in it.message && "unavailable locally" in it.message })
        assertEquals("unresolved", p.jobs.single { it.name == "missing" }.stage)
        assertEquals(listOf(".external"), p.jobs.single { it.name == "missing" }.unresolvedExtends)
        assertEquals("build", p.jobs.single { it.name == "explicit" }.stage)
    }

    @Test fun inheritanceLimitAppliesEvenToCachedParents() {
        val templates = (0..11).joinToString("\n") { i ->
            if (i == 0) ".level0: {stage: deploy}" else ".level$i: {extends: .level${i - 1}}"
        }
        parse("stages: [deploy]\n$templates\nallowed: {extends: .level10}\ntoo-deep: {extends: .level11}") { p ->
            assertEquals("deploy", p.jobs.single { it.name == "allowed" }.stage)
            assertTrue(p.jobs.single { it.name == "too-deep" }.unresolvedExtends.isNotEmpty())
            assertTrue(p.warnings.any { "11 inheritance levels" in it.message })
        }
    }
}
