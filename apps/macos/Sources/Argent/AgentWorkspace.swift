import Foundation
import OSLog

enum AgentWorkspace {
    private static let logger = Logger(subsystem: "ai.argent", category: "workspace")
    static let agentsFilename = "AGENTS.md"
    static let soulFilename = "SOUL.md"
    static let identityFilename = "IDENTITY.md"
    static let userFilename = "USER.md"
    static let bootstrapFilename = "BOOTSTRAP.md"
    static let workflowsFilename = "WORKFLOWS.md"
    static let memoryFilename = "MEMORY.md"
    static let toolsFilename = "TOOLS.md"
    static let heartbeatFilename = "HEARTBEAT.md"
    static let contemplationFilename = "CONTEMPLATION.md"
    private static let templateDirname = "reference/templates"
    private static let ignoredEntries: Set<String> = [".DS_Store", ".git", ".gitignore"]
    private static let templateEntries: Set<String> = [
        AgentWorkspace.agentsFilename,
        AgentWorkspace.soulFilename,
        AgentWorkspace.identityFilename,
        AgentWorkspace.userFilename,
        AgentWorkspace.bootstrapFilename,
        AgentWorkspace.workflowsFilename,
        AgentWorkspace.memoryFilename,
        AgentWorkspace.toolsFilename,
        AgentWorkspace.heartbeatFilename,
        AgentWorkspace.contemplationFilename,
    ]
    enum BootstrapSafety: Equatable {
        case safe
        case unsafe(reason: String)
    }

    static func displayPath(for url: URL) -> String {
        let home = FileManager().homeDirectoryForCurrentUser.path
        let path = url.path
        if path == home { return "~" }
        if path.hasPrefix(home + "/") {
            return "~/" + String(path.dropFirst(home.count + 1))
        }
        return path
    }

    static func resolveWorkspaceURL(from userInput: String?) -> URL {
        let trimmed = userInput?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty { return ArgentConfigFile.defaultWorkspaceURL() }
        let expanded = (trimmed as NSString).expandingTildeInPath
        return URL(fileURLWithPath: expanded, isDirectory: true)
    }

    static func agentsURL(workspaceURL: URL) -> URL {
        workspaceURL.appendingPathComponent(self.agentsFilename)
    }

    static func workspaceEntries(workspaceURL: URL) throws -> [String] {
        let contents = try FileManager().contentsOfDirectory(atPath: workspaceURL.path)
        return contents.filter { !self.ignoredEntries.contains($0) }
    }

    static func isWorkspaceEmpty(workspaceURL: URL) -> Bool {
        let fm = FileManager()
        var isDir: ObjCBool = false
        if !fm.fileExists(atPath: workspaceURL.path, isDirectory: &isDir) {
            return true
        }
        guard isDir.boolValue else { return false }
        guard let entries = try? self.workspaceEntries(workspaceURL: workspaceURL) else { return false }
        return entries.isEmpty
    }

    static func isTemplateOnlyWorkspace(workspaceURL: URL) -> Bool {
        guard let entries = try? self.workspaceEntries(workspaceURL: workspaceURL) else { return false }
        guard !entries.isEmpty else { return true }
        return Set(entries).isSubset(of: self.templateEntries)
    }

    static func bootstrapSafety(for workspaceURL: URL) -> BootstrapSafety {
        let fm = FileManager()
        var isDir: ObjCBool = false
        if !fm.fileExists(atPath: workspaceURL.path, isDirectory: &isDir) {
            return .safe
        }
        if !isDir.boolValue {
            return .unsafe(reason: "Workspace path points to a file.")
        }
        let agentsURL = self.agentsURL(workspaceURL: workspaceURL)
        if fm.fileExists(atPath: agentsURL.path) {
            return .safe
        }
        do {
            let entries = try self.workspaceEntries(workspaceURL: workspaceURL)
            return entries.isEmpty
                ? .safe
                : .unsafe(reason: "Folder isn't empty. Choose a new folder or add AGENTS.md first.")
        } catch {
            return .unsafe(reason: "Couldn't inspect the workspace folder.")
        }
    }

    static func bootstrap(workspaceURL: URL) throws -> URL {
        let shouldSeedBootstrap = self.isWorkspaceEmpty(workspaceURL: workspaceURL)
        try FileManager().createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        let agentsURL = self.agentsURL(workspaceURL: workspaceURL)
        if !FileManager().fileExists(atPath: agentsURL.path) {
            try self.defaultTemplate().write(to: agentsURL, atomically: true, encoding: .utf8)
            self.logger.info("Created AGENTS.md at \(agentsURL.path, privacy: .public)")
        }
        let soulURL = workspaceURL.appendingPathComponent(self.soulFilename)
        if !FileManager().fileExists(atPath: soulURL.path) {
            try self.defaultSoulTemplate().write(to: soulURL, atomically: true, encoding: .utf8)
            self.logger.info("Created SOUL.md at \(soulURL.path, privacy: .public)")
        }
        let identityURL = workspaceURL.appendingPathComponent(self.identityFilename)
        if !FileManager().fileExists(atPath: identityURL.path) {
            try self.defaultIdentityTemplate().write(to: identityURL, atomically: true, encoding: .utf8)
            self.logger.info("Created IDENTITY.md at \(identityURL.path, privacy: .public)")
        }
        let userURL = workspaceURL.appendingPathComponent(self.userFilename)
        if !FileManager().fileExists(atPath: userURL.path) {
            try self.defaultUserTemplate().write(to: userURL, atomically: true, encoding: .utf8)
            self.logger.info("Created USER.md at \(userURL.path, privacy: .public)")
        }
        let workflowsURL = workspaceURL.appendingPathComponent(self.workflowsFilename)
        if !FileManager().fileExists(atPath: workflowsURL.path) {
            try self.defaultWorkflowsTemplate().write(to: workflowsURL, atomically: true, encoding: .utf8)
            self.logger.info("Created WORKFLOWS.md at \(workflowsURL.path, privacy: .public)")
        }
        let memoryDirURL = workspaceURL.appendingPathComponent("memory")
        try FileManager().createDirectory(at: memoryDirURL, withIntermediateDirectories: true)
        let memoryURL = workspaceURL.appendingPathComponent(self.memoryFilename)
        if !FileManager().fileExists(atPath: memoryURL.path) {
            try self.defaultMemoryTemplate().write(to: memoryURL, atomically: true, encoding: .utf8)
            self.logger.info("Created MEMORY.md at \(memoryURL.path, privacy: .public)")
        }
        let toolsURL = workspaceURL.appendingPathComponent(self.toolsFilename)
        if !FileManager().fileExists(atPath: toolsURL.path) {
            try self.defaultToolsTemplate().write(to: toolsURL, atomically: true, encoding: .utf8)
            self.logger.info("Created TOOLS.md at \(toolsURL.path, privacy: .public)")
        }
        let heartbeatURL = workspaceURL.appendingPathComponent(self.heartbeatFilename)
        if !FileManager().fileExists(atPath: heartbeatURL.path) {
            try self.defaultHeartbeatTemplate().write(to: heartbeatURL, atomically: true, encoding: .utf8)
            self.logger.info("Created HEARTBEAT.md at \(heartbeatURL.path, privacy: .public)")
        }
        let contemplationURL = workspaceURL.appendingPathComponent(self.contemplationFilename)
        if !FileManager().fileExists(atPath: contemplationURL.path) {
            try self.defaultContemplationTemplate().write(to: contemplationURL, atomically: true, encoding: .utf8)
            self.logger.info("Created CONTEMPLATION.md at \(contemplationURL.path, privacy: .public)")
        }
        let bootstrapURL = workspaceURL.appendingPathComponent(self.bootstrapFilename)
        if shouldSeedBootstrap, !FileManager().fileExists(atPath: bootstrapURL.path) {
            try self.defaultBootstrapTemplate().write(to: bootstrapURL, atomically: true, encoding: .utf8)
            self.logger.info("Created BOOTSTRAP.md at \(bootstrapURL.path, privacy: .public)")
        }
        return agentsURL
    }

    static func needsBootstrap(workspaceURL: URL) -> Bool {
        let fm = FileManager()
        var isDir: ObjCBool = false
        if !fm.fileExists(atPath: workspaceURL.path, isDirectory: &isDir) {
            return true
        }
        guard isDir.boolValue else { return true }
        if self.hasIdentity(workspaceURL: workspaceURL) {
            return false
        }
        let bootstrapURL = workspaceURL.appendingPathComponent(self.bootstrapFilename)
        guard fm.fileExists(atPath: bootstrapURL.path) else { return false }
        return self.isTemplateOnlyWorkspace(workspaceURL: workspaceURL)
    }

    static func hasIdentity(workspaceURL: URL) -> Bool {
        let identityURL = workspaceURL.appendingPathComponent(self.identityFilename)
        guard let contents = try? String(contentsOf: identityURL, encoding: .utf8) else { return false }
        return self.identityLinesHaveValues(contents)
    }

    private static func identityLinesHaveValues(_ content: String) -> Bool {
        for line in content.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.hasPrefix("-"), let colon = trimmed.firstIndex(of: ":") else { continue }
            let value = trimmed[trimmed.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty {
                return true
            }
        }
        return false
    }

    static func defaultTemplate() -> String {
        let fallback = """
        # AGENTS.md — Workspace Operating Contract (Seed)

        This is the default operating contract for a brand-new agent.

        ## Session Startup (always)
        1. Read `WORKFLOWS.md` first.
        2. Read `SOUL.md`.
        3. Read `USER.md`.
        4. Read today's and yesterday's files in `memory/`.
        5. If this is a direct operator session, read `MEMORY.md`.

        ## Core Behavior
        - Think first, then act.
        - Evidence over claims.
        - Complete loops: action + visibility + tracking.
        - Be proactive internally, careful externally.

        ## Safety + Trust
        - Never exfiltrate private data.
        - Ask before external/public actions unless pre-approved.
        - Prefer recoverable operations for destructive changes.

        ## Memory Discipline
        - If it matters, write it down.
        - Store operator preferences, decisions, and lessons.
        - Keep `MEMORY.md` curated and `memory/YYYY-MM-DD.md` raw.

        ## Group Communication
        - Add value; do not dominate.
        - Respond when asked or when useful.
        - Stay quiet when no value is added.
        """
        return self.loadTemplate(named: self.agentsFilename, fallback: fallback)
    }

    static func defaultSoulTemplate() -> String {
        let fallback = """
        # SOUL.md — Default Character (Seed)

        You are not a script. You are a practical partner.

        ## Core traits
        - Helpful over performative
        - Honest over polished
        - Resourceful before asking
        - Calm under ambiguity
        - Respectful with private context

        ## Style
        - Conversational, direct, human.
        - Clear opinions when useful.
        - No inflated certainty.

        ## Standard
        Be the assistant a competent operator trusts in hard moments.
        """
        return self.loadTemplate(named: self.soulFilename, fallback: fallback)
    }

    static func defaultIdentityTemplate() -> String {
        let fallback = """
        # IDENTITY.md — Agent Identity Template

        - **Name:**
        - **Type/Nature:**
        - **Vibe:**
        - **Emoji:**
        - **Avatar:**

        > Fill this during first operator onboarding.
        """
        return self.loadTemplate(named: self.identityFilename, fallback: fallback)
    }

    static func defaultUserTemplate() -> String {
        let fallback = """
        # USER.md — Operator Profile Template

        - **Name:**
        - **Preferred address:**
        - **Timezone:**
        - **Pronouns (optional):**
        - **Communication style:**
        - **Working preferences:**
        - **Do-not-do list:**

        ## Current priorities
        -

        ## Important context
        -
        """
        return self.loadTemplate(named: self.userFilename, fallback: fallback)
    }

    static func defaultBootstrapTemplate() -> String {
        let fallback = """
        # BOOTSTRAP.md — First-Run Onboarding

        ## Goal
        Create identity and operator bond safely.

        ## Sequence
        1. Fill `IDENTITY.md` with operator.
        2. Fill `USER.md` basics.
        3. Confirm workflows in `WORKFLOWS.md`.
        4. Capture first three preferences in memory.
        5. Remove this file after onboarding completes.
        """
        return self.loadTemplate(named: self.bootstrapFilename, fallback: fallback)
    }

    static func defaultWorkflowsTemplate() -> String {
        let fallback = """
        # WORKFLOWS.md — Default Workflow Rules (Seed)

        ## Purpose
        Execution quality guardrails for all work.

        ## Rules

        ### 1) New project alignment
        - For new projects, scope first.
        - Do not execute live actions until operator gives explicit go-ahead.

        ### 2) Visibility requirement
        Completion means:
        1. action done,
        2. traceable artifact created (task/doc/issue/log),
        3. confirmation with evidence.

        ### 3) Issue tracking hygiene
        If a defect/feature is created in external tracker, mirror it in internal task tracking.
        Link IDs both ways.

        ### 4) Data freshness
        Operational state is a snapshot.
        Re-query live systems before reporting "current" status.

        ### 5) Reflection loop
        After meaningful work, record:
        - what happened,
        - what changed,
        - what was learned,
        - what should change next.
        """
        return self.loadTemplate(named: self.workflowsFilename, fallback: fallback)
    }

    static func defaultMemoryTemplate() -> String {
        let fallback = """
        # MEMORY.md — Curated Long-Term Memory (Seed)

        Use for durable truths only:
        - operator preferences,
        - recurring constraints,
        - major decisions,
        - proven lessons.

        Keep concise and current.
        """
        return self.loadTemplate(named: self.memoryFilename, fallback: fallback)
    }

    static func defaultToolsTemplate() -> String {
        let fallback = """
        # TOOLS.md — Local Environment Notes

        Use this for machine/operator-specific notes only.

        ## Add here

        - Device nicknames
        - Camera names
        - SSH aliases
        - Preferred voices
        - Channel IDs
        - Environment quirks
        """
        return self.loadTemplate(named: self.toolsFilename, fallback: fallback)
    }

    static func defaultHeartbeatTemplate() -> String {
        let fallback = """
        # HEARTBEAT.md

        # Keep empty by default.

        # Add short recurring checks only when needed.
        """
        return self.loadTemplate(named: self.heartbeatFilename, fallback: fallback)
    }

    static func defaultContemplationTemplate() -> String {
        let fallback = """
        # CONTEMPLATION.md — Reflection Loop (Seed)

        Use quiet cycles to improve quality, not to spin.

        ## Check

        - What changed since last cycle?
        - What is still unclear?
        - What one improvement will reduce future mistakes?

        ## Record

        Capture one concrete lesson and one behavior change.
        """
        return self.loadTemplate(named: self.contemplationFilename, fallback: fallback)
    }

    private static func loadTemplate(named: String, fallback: String) -> String {
        for url in self.templateURLs(named: named) {
            if let content = try? String(contentsOf: url, encoding: .utf8) {
                let stripped = self.stripFrontMatter(content)
                if !stripped.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return stripped
                }
            }
        }
        return fallback
    }

    private static func templateURLs(named: String) -> [URL] {
        var urls: [URL] = []
        if let resource = Bundle.main.url(
            forResource: named.replacingOccurrences(of: ".md", with: ""),
            withExtension: "md",
            subdirectory: self.templateDirname)
        {
            urls.append(resource)
        }
        if let resource = Bundle.main.url(
            forResource: named,
            withExtension: nil,
            subdirectory: self.templateDirname)
        {
            urls.append(resource)
        }
        if let dev = self.devTemplateURL(named: named) {
            urls.append(dev)
        }
        let cwd = URL(fileURLWithPath: FileManager().currentDirectoryPath)
        urls.append(cwd.appendingPathComponent("docs")
            .appendingPathComponent(self.templateDirname)
            .appendingPathComponent(named))
        return urls
    }

    private static func devTemplateURL(named: String) -> URL? {
        let sourceURL = URL(fileURLWithPath: #filePath)
        let repoRoot = sourceURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return repoRoot.appendingPathComponent("docs")
            .appendingPathComponent(self.templateDirname)
            .appendingPathComponent(named)
    }

    private static func stripFrontMatter(_ content: String) -> String {
        guard content.hasPrefix("---") else { return content }
        let start = content.index(content.startIndex, offsetBy: 3)
        guard let range = content.range(of: "\n---", range: start..<content.endIndex) else {
            return content
        }
        let remainder = content[range.upperBound...]
        let trimmed = remainder.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed + "\n"
    }

    // Identity is written by the agent during the bootstrap ritual.
}
