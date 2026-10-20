import { NUMERAL_ASSETS, NUMERAL_WIDTHS } from './NumeralAssets';

let cardStorage: LocalStorage = new LocalStorage();

@Entry(cardStorage)
@Component
struct CourseCard {
  @LocalStorageProp('title') title: string = '打开随课同步课程';
  @LocalStorageProp('room') room: string = '';
  @LocalStorageProp('clock') clock: string = '';
  @LocalStorageProp('state') state: string = '随课';
  @LocalStorageProp('active') @Watch('updateLamp') active: boolean = false;
  @LocalStorageProp('progress') progress: number = 0;
  @LocalStorageProp('next') next: string = '';
  @LocalStorageProp('date') date: string = '';
  @LocalStorageProp('dark') dark: boolean = false;
  @LocalStorageProp('wide') wide: boolean = false;
  @LocalStorageProp('glass') glass: boolean = false;
  @LocalStorageProp('frost') frost: number = 0;
  @LocalStorageProp('generatedClock') generatedClock: string = '--:--';

  @LocalStorageProp('reducedMotion') @Watch('updateLamp') reducedMotion: boolean = false;
  @State lampOpacity: number = 1;
  private compactColumns: number[] = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
  private wideColumns: number[] = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27];
  private pixelRows: number[] = [0,1];

  private lampGeneration: number = 0;
  private present: boolean = false;
  aboutToAppear(): void { this.present = true; this.updateLamp(); }
  aboutToDisappear(): void { this.present = false; this.lampGeneration++; }
  private updateLamp(): void {
    const generation = ++this.lampGeneration;
    // The form runtime supports the global API; UIContext.animateTo is app-only.
    animateTo({ duration: 0 }, () => { this.lampOpacity = 1; });
    if (this.present && this.active && !this.reducedMotion) this.animateLamp(generation, 0.32);
  }
  private animateLamp(generation: number, target: number): void {
    if (generation !== this.lampGeneration || !this.present || !this.active || this.reducedMotion) return;
    animateTo({ duration: 1900, curve: Curve.EaseInOut, onFinish: () => {
      if (generation === this.lampGeneration && this.present && this.active && !this.reducedMotion) {
        this.animateLamp(generation, target === 1 ? 0.32 : 1);
      }
    } }, () => { this.lampOpacity = target; });
  }

  @Builder
  numerals(value: string, size: number, secondary: boolean) {
    Row({ space: 0 }) {
      ForEach(value.split(''), (character: string) => {
        if (NUMERAL_ASSETS[character]) {
          Image(NUMERAL_ASSETS[character]).width(size * NUMERAL_WIDTHS[character]).height(size * 1.172)
            .fillColor(secondary ? this.secondary() : this.foreground()).objectFit(ImageFit.Contain)
        } else {
          Text(character).fontSize(size).fontColor(secondary ? this.secondary() : this.foreground())
        }
      }, (_character: string, index: number) => index.toString())
    }.accessibilityText(value)
  }

  private pixelColor(column: number): string {
    const progress = Number.isFinite(this.progress) ? Math.max(0, Math.min(1, this.progress)) : 0;
    const count = this.wide ? this.wideColumns.length : this.compactColumns.length;
    return this.active && column < Math.ceil(progress * count) ? this.foreground() : (this.dark ? '#353535' : '#E6E6E6');
  }

  @Builder
  pixelProgress() {
    Column({ space: 2 }) {
      ForEach(this.pixelRows, (_row: number) => {
        Row({ space: 2 }) {
          ForEach(this.wide ? this.wideColumns : this.compactColumns, (column: number) => {
            Rect().width(3).height(3).fill(this.pixelColor(column))
          }, (column: number) => column.toString())
        }
      }, (row: number) => row.toString())
    }
    .alignItems(HorizontalAlign.Start)
    .accessibilityText(this.active ? '课程进度 ' + Math.round(this.progress * 100) + '%' : '暂无进行中的课程')
    .margin({ top: 3, bottom: 3 })
  }

  private foreground(): string { return this.dark ? '#F5F5F5' : '#202020'; }
  private secondary(): string { return this.dark ? '#B8B8B8' : '#656565'; }
  private surface(): string {
    // The form has no transparent wallpaper surface. Preserve contrast and
    // adapt the glass preference as an opaque tint instead of claiming blur.
    if (!this.glass) return this.dark ? '#161616' : '#FFFFFF';
    return this.dark ? (this.frost >= 50 ? '#292929' : '#222222') : (this.frost >= 50 ? '#F0F0F0' : '#F7F7F7');
  }

  @Builder
  course() {
    Column({ space: 5 }) {
      Row({ space: 6 }) {
        Circle().width(6).height(6).fill(this.active ? '#22ef68' : '#A4A8A4')
          .opacity(this.active ? this.lampOpacity : 1)
          .accessibilityLevel('no')
        Text(this.state).fontSize(11).fontWeight(FontWeight.Medium).fontColor(this.secondary())
        Blank()
        this.numerals(this.date.slice(5), 11, true)
      }.width('100%')
      Text(this.title).fontSize(this.wide ? 21 : 18).fontWeight(FontWeight.Medium)
        .fontColor(this.foreground()).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%').textAlign(TextAlign.Start)
      Text(this.room.length > 0 ? this.room : '教室未填写').fontSize(12).fontColor(this.secondary())
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
      if (this.clock.length > 0) { this.numerals(this.clock, 12, false) }
      else { Text('查看完整课表').fontSize(12).fontColor(this.foreground()) }
      this.pixelProgress()
      Row() {
        if (this.active) {
          Row({ space: 2 }) {
            Text('课程进度').fontSize(9).fontColor(this.secondary())
            this.numerals(Math.round(this.progress * 100) + '%', 9, true)
          }
        } else { Text('随课').fontSize(9).fontColor(this.secondary()) }
        Blank()
        Row({ space: 3 }) {
          this.numerals(this.generatedClock, 9, true)
          Text('更新').fontSize(9).fontColor(this.secondary())
        }
      }.width('100%')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  build() {
    Row({ space: 16 }) {
      Column() { this.course() }.layoutWeight(1)
      if (this.wide) {
        Column({ space: 8 }) {
          Text('后续安排').fontSize(11).fontColor(this.secondary())
          Text(this.next.length > 0 ? this.next : '暂无后续课程').fontSize(14).fontColor(this.foreground())
            .maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text('点击打开课表').fontSize(10).fontColor(this.secondary())
        }.width('35%').alignItems(HorizontalAlign.Start)
      }
    }
    .padding(this.wide ? 18 : 13)
    .width('100%').height('100%')
    .alignItems(VerticalAlign.Center)
    .backgroundColor(this.surface())
    .onClick(() => {
      postCardAction(this, { action: 'router', abilityName: 'EntryAbility', params: { suikeFromCard: true } });
    })
  }
}
