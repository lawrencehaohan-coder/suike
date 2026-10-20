const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../entry/src/main/resources/rawfile/index.html'),'utf8');
const source=html.slice(html.indexOf('  function nativeStatusText(status) {'),html.indexOf('  function renderProductCourseTools'));
const show=vm.runInNewContext(source+';nativeStatusText;');
test('pending, denied and failed native scheduling is displayed instead of a false permission success',()=>{
  for(const message of ['设置已保存，等待系统取消旧提醒并重新调度。','取消旧提醒失败，请重新打开应用重试。','通知权限未开启。']){
    const text=show({notificationsAllowed:true,notificationPermission:true,reminderMessage:message,cardMessage:'系统后台刷新并非实时。'});
    assert.ok(text.startsWith(message));assert.equal(text.includes('系统已允许通知'),false);
  }
  assert.match(show({notificationsAllowed:null,notificationPermission:null}),/尚未确认/);
  assert.match(show(null),/尚未向鸿蒙系统查询/);
  assert.match(show({notificationsAllowed:false,notificationPermission:false}),/尚未开启/);
  assert.match(show({notificationsAllowed:true,notificationPermission:true}),/系统已允许通知/);
});
test('the local app keeps its offline asset and has no embedded remote school page or test clock',()=>{
  assert.match(html,/connect-src 'none'/);assert.match(html,/frame-src 'none'/);
  assert.ok(html.includes('preview-class-breathe 3.8s'));
  assert.ok(html.includes('SuikeWeekInteractionsUI'));
  assert.equal(html.includes('pixelPreviewProgress'),false);
  assert.equal(html.includes('__suikePixelPreview'),false);
});
