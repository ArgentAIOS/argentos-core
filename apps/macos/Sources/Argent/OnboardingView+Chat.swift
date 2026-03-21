import Foundation

extension OnboardingView {
    func maybeKickoffOnboardingChat(for pageIndex: Int) {
        guard pageIndex == self.onboardingChatPageIndex else { return }
        guard self.showOnboardingChat else { return }
        guard !self.didAutoKickoff else { return }
        self.didAutoKickoff = true

        Task { @MainActor in
            for _ in 0..<20 {
                if !self.onboardingChatModel.isLoading { break }
                try? await Task.sleep(nanoseconds: 200_000_000)
            }
            guard self.onboardingChatModel.messages.isEmpty else { return }
            let kickoff =
                "Hey — this is our first conversation. " +
                "Start the first-run ritual from BOOTSTRAP.md and guide it naturally, one question at a time. " +
                "Begin with identity and relationship: help us define who you are, who I am, and how we work together. " +
                "Then open SOUL.md with me and shape your tone, boundaries, and working style. " +
                "After that, help me choose how we stay connected (web, WhatsApp, or Telegram). " +
                "Keep this warm, human, and concise."
            self.onboardingChatModel.input = kickoff
            self.onboardingChatModel.send()
        }
    }
}
