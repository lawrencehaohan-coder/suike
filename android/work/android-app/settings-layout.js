  // Lucide monitor/download geometry, rendered with the existing 24px outline system.
  function settingsIconHeading(title, paths) {
    const row=node('div','card-heading'),badge=node('span','section-icon'),copy=node('div');
    badge.setAttribute('aria-hidden','true');badge.append(pfIcon(paths));copy.append(title);row.append(badge,copy);return row;
  }
  // Keep existing settings cards and controls; disclose long, occasional sections on demand.
  function foldSettingsCard(card, heading, id) {
    if (!card || !heading) return;
    const children = Array.from(card.children);
    const fold = node('details', 'settings-fold'); fold.id = id;
    const summary = node('summary', 'settings-fold-heading');
    const chevron = pfIcon(['m6 9 6 6 6-6']); chevron.setAttribute('class', 'settings-fold-chevron');
    summary.append(heading, chevron);
    const content = node('div', 'settings-fold-content');
    children.forEach(child => { if (child !== heading) content.append(child); });
    fold.append(summary, content); card.replaceChildren(fold);
    card.classList.add('settings-fold-card');
    // Native form validation must reveal the control that requires attention.
    card.addEventListener('invalid', () => { fold.open = true; }, true);
  }
  foldSettingsCard($('settingsForm'), $('settingsForm').querySelector('.card-heading'), 'settingsSemesterDetails');
  foldSettingsCard(backupCard, backupCard.querySelector('.card-heading'), 'settingsBackupDetails');
  const installCard = $('installTitle') && $('installTitle').closest('section');
  foldSettingsCard(installCard, installCard && installCard.querySelector('.card-heading'), 'settingsInstallDetails');
  const periodsCard = $('periodTitle').closest('section');
  foldSettingsCard(periodsCard, $('periodTitle'), 'settingsPeriodsDetails');
