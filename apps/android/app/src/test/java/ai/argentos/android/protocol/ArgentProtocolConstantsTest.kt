package ai.argentos.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class ArgentProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", ArgentCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", ArgentCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", ArgentCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", ArgentCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", ArgentCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", ArgentCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", ArgentCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", ArgentCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", ArgentCapability.Canvas.rawValue)
    assertEquals("camera", ArgentCapability.Camera.rawValue)
    assertEquals("screen", ArgentCapability.Screen.rawValue)
    assertEquals("voiceWake", ArgentCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", ArgentScreenCommand.Record.rawValue)
  }
}
