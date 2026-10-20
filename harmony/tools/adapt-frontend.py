"""Apply small Harmony-only wording/status changes to the bundled beta.10 UI."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
page = root / 'entry/src/main/resources/rawfile/index.html'
text = page.read_text(encoding='utf-8')
old = '''  function nativeStatusText(status) {
    if (!status) return "系统通知与调度状态会在随课鸿蒙应用中显示。";
    if (status.notificationsAllowed === false || status.notificationPermission === false) return "系统通知权限尚未开启：设置会保存，但提醒不会送达。可在系统设置中允许随课通知。";
    return "系统已允许通知；提醒由鸿蒙系统调度，实际送达时间受系统限制。";
  }'''
new = '''  function nativeStatusText(status) {
    if (!status) return "尚未向鸿蒙系统查询提醒状态。";
    if (typeof status.reminderMessage === "string" && status.reminderMessage) {
      return status.reminderMessage + (status.cardMessage ? " " + status.cardMessage : "");
    }
    if (status.notificationsAllowed === false || status.notificationPermission === false) return "系统通知权限尚未开启：设置会保存，但提醒不会送达。可在系统设置中允许随课通知。";
    if (status.notificationsAllowed !== true || status.notificationPermission !== true) return "尚未确认系统通知权限；请稍后重新查看。";
    return "系统已允许通知；提醒由鸿蒙系统代理调度，实际送达受系统设置影响。";
  }'''
assert old in text or new in text, 'Reminder status integration changed'
text = text.replace(old,new)
text = text.replace('提醒由系统调度（约 10 分钟窗口），不是精确闹钟；省电、勿扰或强制停止可能推迟送达。', '提醒由鸿蒙系统代理调度；省电、勿扰或通知权限可能影响送达。')
text = text.replace('"添加 4×2"', '"如何添加 2×4"').replace('"添加 2×2"', '"如何添加 2×2"')
text = text.replace('在小组件中找到「随课」', '选择服务卡片，再添加「随课 · 2×4」')
text = text.replace('在小组件中选择「随课 · 2×2」', '选择服务卡片，再添加「随课 · 2×2」')
text = text.replace('外观跟随「学期与显示」中的玻璃开关与磨砂程度。', '卡片跟随黑白主题；玻璃与磨砂参数会保存，原生卡片目前使用实色背景。')
page.write_text(text,encoding='utf-8',newline='\n')

manifest = root / 'entry/src/main/module.json5'
data = json.loads(manifest.read_text(encoding='utf-8'))
permissions = data['module']['requestPermissions']
if not any(p['name']=='ohos.permission.VIBRATE' for p in permissions):
    permissions.append({'name':'ohos.permission.VIBRATE'})
manifest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'frontend':'beta.10 preserved; Harmony status and wording adapted','vibrationPermission':True},ensure_ascii=False))
