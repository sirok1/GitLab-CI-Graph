package space.sirok.gitlabcigraph.settings

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.components.*
import com.intellij.openapi.project.Project

@Service(Service.Level.PROJECT)
@State(name = "GitLabCiGraph", storages = [Storage("gitlab-ci-graph.xml")])
class GraphSettings : PersistentStateComponent<GraphSettings.State> {
    data class State(var url: String = "", var project: String = "", var ref: String = "main", var selectedFile: String = "")
    private var data = State()
    override fun getState() = data
    override fun loadState(state: State) { data = state }
    companion object { fun get(project: Project) = project.getService(GraphSettings::class.java) }
}

object TokenStore {
    private fun attributes(url: String, project: String) = CredentialAttributes("GitLab CI Graph:${url.trimEnd('/')}:$project")
    fun get(url: String, project: String): String = PasswordSafe.instance.getPassword(attributes(url, project)) ?: ""
    fun set(url: String, project: String, token: String) = PasswordSafe.instance.set(attributes(url, project), if (token.isBlank()) null else Credentials("token", token))
}
