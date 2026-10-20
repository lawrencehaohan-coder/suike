import { UIAbility, Want, AbilityConstant } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    this.captureLaunch(want);
  }
  onNewWant(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    this.captureLaunch(want);
  }
  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (error) => {
      if (error.code) console.error('SUIKE_MAIN_PAGE_LOAD_FAILED');
    });
  }
  private captureLaunch(want: Want): void {
    if (want.parameters && (want.parameters['suikeFromCard'] === true || want.parameters['fromWidget'] === true)) {
      AppStorage.setOrCreate<boolean>('suike.widget.launch', true);
    }
  }
}
