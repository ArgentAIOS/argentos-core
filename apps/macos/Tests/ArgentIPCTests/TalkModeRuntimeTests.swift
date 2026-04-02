import Testing
@testable import Argent

@Suite struct TalkModeRuntimeTests {
    @Test func playbackInterruptionRecognitionIsReusedWhenAlreadyActive() {
        let shouldRestart = TalkModeRuntime._testShouldRestartRecognition(
            currentMode: "playbackInterruption",
            hasActiveRecognition: true,
            requestedMode: "playbackInterruption")

        #expect(shouldRestart == false)
    }

    @Test func listeningRestartStillOccursWhenSwitchingModes() {
        let shouldRestart = TalkModeRuntime._testShouldRestartRecognition(
            currentMode: "playbackInterruption",
            hasActiveRecognition: true,
            requestedMode: "listening")

        #expect(shouldRestart)
    }

    @Test func missingRecognitionPipelineForcesRestart() {
        let shouldRestart = TalkModeRuntime._testShouldRestartRecognition(
            currentMode: "playbackInterruption",
            hasActiveRecognition: false,
            requestedMode: "playbackInterruption")

        #expect(shouldRestart)
    }
}
