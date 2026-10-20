plugins {
    kotlin("jvm") version "2.2.20"
    id("org.jetbrains.intellij.platform") version "2.19.0"
}
group = "space.sirok"
version = providers.gradleProperty("pluginVersion").get()
repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}
dependencies {
    intellijPlatform {
        intellijIdea("2025.3.1")
        bundledPlugin("org.jetbrains.plugins.yaml")
        bundledPlugin("com.intellij.modules.jcef")
        pluginVerifier()
        testFramework(org.jetbrains.intellij.platform.gradle.TestFrameworkType.Platform)
    }
    implementation("org.yaml:snakeyaml:2.4")
    implementation("com.google.code.gson:gson:2.13.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation(kotlin("stdlib"))
}
kotlin {
    jvmToolchain(21)
    compilerOptions { jvmDefault = org.jetbrains.kotlin.gradle.dsl.JvmDefaultMode.NO_COMPATIBILITY }
}
intellijPlatform {
    pluginConfiguration { ideaVersion { sinceBuild = "253.29346" } }
    pluginVerification {
        ides { current() }
        // The requested reverse-domain ID starts with space; keep it stable and mute only this naming rule.
        freeArgs = listOf("-mute", "TemplateWordInPluginId")
    }
}
val npm = if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm"
val frontendInstall by tasks.registering(Exec::class) {
    workingDir("frontend")
    commandLine(npm, "ci", "--no-audit", "--no-fund")
    inputs.files("frontend/package.json", "frontend/package-lock.json")
    outputs.dir("frontend/node_modules")
}
val frontendBuild by tasks.registering(Exec::class) {
    dependsOn(frontendInstall)
    workingDir("frontend")
    commandLine(npm, "run", "build")
    inputs.dir("frontend/src")
    inputs.files("frontend/index.html", "frontend/vite.config.ts", "frontend/tsconfig.json")
    outputs.dir("frontend/dist")
}
tasks.processResources {
    dependsOn(frontendBuild)
    from("frontend/dist") { into("web") }
}
tasks.register<Exec>("frontendTest") {
    dependsOn(frontendInstall)
    workingDir("frontend")
    commandLine(npm, "test")
}
tasks.test { dependsOn("frontendTest") }
tasks.runIde {
    args(project.layout.projectDirectory.dir("examples").asFile.absolutePath)
    providers.gradleProperty("jcefDebugPort").orNull?.let { systemProperty("ide.browser.jcef.debug.port", it) }
}
