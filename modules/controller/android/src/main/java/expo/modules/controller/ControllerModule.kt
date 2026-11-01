package expo.modules.controller

import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.Window
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Observe controller events at the window without stealing keyboard/text focus. */
class ControllerModule : Module() {
  private var window: Window? = null
  private var original: Window.Callback? = null
  private var installed: Window.Callback? = null
  private var lastMotion = 0L

  override fun definition() = ModuleDefinition {
    Name("WalkthroughController")
    Events("onInput")
    Function("start") { attach() }
    OnActivityEntersForeground { attach() }
    OnActivityEntersBackground { detach() }
    OnDestroy { detach() }
  }

  private fun attach() {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      if (installed != null && activity.window.callback === installed) return@runOnUiThread
      val previous = activity.window.callback ?: return@runOnUiThread
      val callback = object : Window.Callback by previous {
        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
          val controller = event.isFromSource(InputDevice.SOURCE_GAMEPAD) ||
            event.isFromSource(InputDevice.SOURCE_JOYSTICK) ||
            event.isFromSource(InputDevice.SOURCE_DPAD)
          if (!controller) return previous.dispatchKeyEvent(event)
          val action = when (event.keyCode) {
            KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_DPAD_CENTER -> "confirm"
            KeyEvent.KEYCODE_BUTTON_B -> "back"
            KeyEvent.KEYCODE_BUTTON_L1 -> "previous"
            KeyEvent.KEYCODE_BUTTON_R1 -> "next"
            KeyEvent.KEYCODE_BUTTON_START, KeyEvent.KEYCODE_MENU -> "menu"
            KeyEvent.KEYCODE_DPAD_UP -> "up"
            KeyEvent.KEYCODE_DPAD_DOWN -> "down"
            KeyEvent.KEYCODE_DPAD_LEFT -> "left"
            KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
            else -> return previous.dispatchKeyEvent(event)
          }
          if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0)
            sendEvent("onInput", mapOf("action" to action))
          return true
        }

        override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
          if (!event.isFromSource(InputDevice.SOURCE_JOYSTICK))
            return previous.dispatchGenericMotionEvent(event)
          val x = event.getAxisValue(MotionEvent.AXIS_X) + event.getAxisValue(MotionEvent.AXIS_HAT_X)
          val y = event.getAxisValue(MotionEvent.AXIS_Y) + event.getAxisValue(MotionEvent.AXIS_HAT_Y)
          val action = when {
            x > .6f -> "right"
            x < -.6f -> "left"
            y > .6f -> "down"
            y < -.6f -> "up"
            else -> return previous.dispatchGenericMotionEvent(event)
          }
          if (event.eventTime - lastMotion >= 180) {
            lastMotion = event.eventTime
            sendEvent("onInput", mapOf("action" to action))
          }
          return true
        }
      }
      window = activity.window
      original = previous
      installed = callback
      activity.window.callback = callback
    }
  }

  private fun detach() {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      if (window?.callback === installed) window?.callback = original
      window = null
      original = null
      installed = null
    }
  }
}
