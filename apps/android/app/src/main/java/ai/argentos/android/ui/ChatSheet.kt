package ai.argentos.android.ui

import androidx.compose.runtime.Composable
import ai.argentos.android.MainViewModel
import ai.argentos.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
