package space.sirok.gitlabcigraph.parser

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path

class LocalPipelineParserTest {
    private val root = Path.of(javaClass.getResource("/fixtures/simple.yml")!!.toURI()).parent
    @Test fun simple() {
        val p = LocalPipelineParser().parse(root, root.resolve("simple.yml"))
        assertTrue(p.errors.toString(), p.valid)
        assertEquals(2, p.jobs.size); assertEquals(1, p.edges.size)
        assertEquals("build", p.edges.single().source); assertEquals("test", p.edges.single().target)
        assertEquals(2, p.stages.size)
        assertEquals(2, p.jobs.first().sourceLine?.toInt())
    }
    @Test fun complexIncludesHiddenAndReserved() {
        val p = LocalPipelineParser().parse(root, root.resolve("complex.yml"))
        assertTrue(p.errors.toString(), p.valid)
        assertEquals(setOf("build", "prepare", "test"), p.jobs.map { it.name }.toSet())
        val j = p.jobs.last()
        assertEquals(listOf(".base"), j.extends); assertEquals(1, j.rulesCount)
        assertEquals("manual", j.whenType); assertEquals(true, j.allowFailure)
        assertTrue(j.hasArtifacts); assertNotNull(j.trigger); assertEquals("production", j.environment)
        assertEquals(true, p.edges.first().artifacts); assertTrue(p.edges.last().optional)
        assertEquals("ci/build.yml", p.jobs.first().sourceFile)
        assertTrue(p.warnings.any { "External include" in it.message })
    }
    @Test fun invalidYamlIsReported() {
        val temp = Files.createTempDirectory("ci-graph-test")
        try {
            val f = temp.resolve(".gitlab-ci.yml"); Files.writeString(f, "test: [unterminated")
            assertFalse(LocalPipelineParser().parse(temp, f).valid)
        } finally { temp.toFile().deleteRecursively() }
    }
    @Test fun cycleAndTraversalAreBounded() {
        val temp = Files.createTempDirectory("ci-graph-cycle")
        try {
            val f = temp.resolve(".gitlab-ci.yml")
            Files.writeString(f, "include: [{local: '/.gitlab-ci.yml'}, {local: '/../outside.yml'}]\njob:\n  script: echo ok")
            val p = LocalPipelineParser().parse(temp, f)
            assertEquals(1, p.jobs.size); assertTrue(p.warnings.any { "cycle" in it.message }); assertTrue(p.warnings.any { "outside project" in it.message })
        } finally { temp.toFile().deleteRecursively() }
    }
    @Test fun unsavedDocumentSnapshotsOverrideDiskIncludingLocalIncludes() {
        val temp = Files.createTempDirectory("ci-graph-documents")
        try {
            val main = temp.resolve(".gitlab-ci.yml")
            val included = temp.resolve("jobs.yml")
            Files.writeString(main, "old-job:\n  script: echo saved")
            Files.writeString(included, "old-include:\n  script: echo saved")
            val documents = mutableMapOf(
                main.toRealPath() to "include: jobs.yml\nnew-job:\n  needs: [new-include]\n  script: echo edited",
                included.toRealPath() to "new-include:\n  script: echo edited",
            )
            val parser = LocalPipelineParser { documents[it] ?: Files.readString(it) }
            val edited = parser.parse(temp, main)
            assertTrue(edited.errors.toString(), edited.valid)
            assertEquals(setOf("new-job", "new-include"), edited.jobs.map { it.name }.toSet())
            assertEquals("new-include", edited.edges.single().source)
            documents[included.toRealPath()] = "updated-include:\n  script: echo edited again"
            assertTrue(parser.parse(temp, main).jobs.any { it.name == "updated-include" })
            assertTrue(Files.readString(main).contains("old-job"))
            assertTrue(Files.readString(included).contains("old-include"))
        } finally { temp.toFile().deleteRecursively() }
    }
}
