import { Configuration, Want } from '@kit.AbilityKit';
import { FormExtensionAbility, formBindingData, formInfo, formProvider } from '@kit.FormKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { AtomicStore } from '../services/AtomicStore';
import {
  CourseFormRecord, CourseFormRegistry, FORM_REGISTRY_FILE,
  createCourseCardData, readCourseForms, systemDark
} from '../services/FeatureService';

export default class CourseFormAbility extends FormExtensionAbility {
  onAddForm(want: Want): formBindingData.FormBindingData {
    const store = new AtomicStore(this.context.filesDir);
    const params = want.parameters;
    const rawId = params ? params[formInfo.FormParam.IDENTITY_KEY] : undefined;
    const name = params ? params[formInfo.FormParam.NAME_KEY] : undefined;
    const dimension = params ? params[formInfo.FormParam.DIMENSION_KEY] : undefined;
    const wide = name === 'CourseWide' || dimension === formInfo.FormDimension.Dimension_2_4;
    // Form IDs are 64-bit identifiers represented as strings; never parse them
    // through a JS number, which would lose precision.
    if (typeof rawId === 'string' && /^[0-9]{1,24}$/.test(rawId)) {
      try {
        let registry: CourseFormRegistry;
        try { registry = readCourseForms(store); }
        catch (_) {
          registry = { version: 1, forms: [] };
          hilog.warn(0x0000, 'SuikeForm', 'Recreating invalid form registry during manual addition');
        }
        registry.forms = registry.forms.filter((entry: CourseFormRecord) => entry.id !== rawId);
        registry.forms.push({ id: rawId, wide: wide });
        if (!store.write(FORM_REGISTRY_FILE, JSON.stringify(registry))) throw new Error('FORM_REGISTRY_WRITE_FAILED');
      } catch (_) { hilog.error(0x0000, 'SuikeForm', 'Unable to persist form registration'); }
      this.schedule(rawId);
    } else { hilog.error(0x0000, 'SuikeForm', 'Missing string form identity'); }
    return formBindingData.createFormBindingData(createCourseCardData(store, systemDark(this.context), wide));
  }

  onUpdateForm(formId: string): void { this.update(formId); }

  onFormEvent(formId: string, message: string): void {
    // The card's refresh action can request a new snapshot. It does not add
    // reminders or request notification permission from an extension process.
    try {
      const event = JSON.parse(message) as Record<string, string>;
      if (event.action === 'refresh' || event.message === 'refresh') this.update(formId);
    } catch (_) { hilog.warn(0x0000, 'SuikeForm', 'Ignored malformed form action'); }
  }

  onRemoveForm(formId: string): void {
    const store = new AtomicStore(this.context.filesDir);
    try {
      const registry = readCourseForms(store);
      registry.forms = registry.forms.filter((form: CourseFormRecord) => form.id !== formId);
      if (!store.write(FORM_REGISTRY_FILE, JSON.stringify(registry))) throw new Error('FORM_REGISTRY_WRITE_FAILED');
    } catch (_) { hilog.error(0x0000, 'SuikeForm', 'Unable to remove form registration'); }
  }

  onCastToNormalForm(formId: string): void { this.update(formId); }

  onConfigurationUpdate(_config: Configuration): void {
    try {
      const registry = readCourseForms(new AtomicStore(this.context.filesDir));
      registry.forms.forEach((form: CourseFormRecord) => { this.update(form.id); });
    } catch (_) { hilog.error(0x0000, 'SuikeForm', 'Unable to refresh form color mode'); }
  }

  private update(formId: string): void {
    const store = new AtomicStore(this.context.filesDir);
    try {
      const registry = readCourseForms(store);
      const record = registry.forms.find((form: CourseFormRecord) => form.id === formId);
      if (!record) { hilog.warn(0x0000, 'SuikeForm', 'Unknown form identity; re-add the card'); return; }
      const data = createCourseCardData(store, systemDark(this.context), record.wide);
      formProvider.updateForm(formId, formBindingData.createFormBindingData(data)).then(() => {
        this.schedule(formId);
      }).catch((error: BusinessError) => {
        hilog.error(0x0000, 'SuikeForm', 'updateForm failed, code=%{public}d', error.code);
      });
    } catch (_) { hilog.error(0x0000, 'SuikeForm', 'Unable to read course snapshot'); }
  }

  private schedule(formId: string): void {
    try {
      const store = new AtomicStore(this.context.filesDir);
      const data = createCourseCardData(store, systemDark(this.context), false);
      // Public API permits no interval shorter than five minutes. The launcher
      // may defer or reject requests according to its daily refresh quota;
      // form_config's periodic update remains the fallback.
      const minutes = Math.max(5, Math.min(30, Math.ceil((data.nextRefresh - Date.now()) / 60000)));
      formProvider.setFormNextRefreshTime(formId, minutes).catch((error: BusinessError) => {
        hilog.warn(0x0000, 'SuikeForm', 'Next form refresh not accepted, code=%{public}d', error.code);
      });
    } catch (_) { hilog.warn(0x0000, 'SuikeForm', 'Unable to request next form refresh'); }
  }
}
