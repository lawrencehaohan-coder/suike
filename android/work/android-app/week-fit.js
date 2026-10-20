  // Seven visible columns; a short screen may scroll vertically, never sideways.
  (function installWeekFit() {
    const wrap = document.querySelector('.week-grid-wrap');
    wrap.setAttribute('aria-label', '整周课表，周一至周日同屏，点课程查看完整详情');
    const hint = document.querySelector('.week-hint');
    hint.textContent = '周一至周日同屏 · 点课程查看完整名称、地点和时间';
    const conflictDialog = node('dialog', 'week-conflict-dialog'); conflictDialog.id='weekConflictDialog';
    conflictDialog.setAttribute('aria-labelledby','weekConflictTitle');
    const heading=node('div','dialog-heading'), title=node('h2','','同一时段的课程'); title.id='weekConflictTitle';
    const close=button('button button-outline','关闭',()=>closeDialog(conflictDialog));
    heading.append(title,close);
    const conflictList=node('div','week-conflict-list');conflictDialog.append(heading,conflictList);document.body.append(conflictDialog);
    conflictDialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog(conflictDialog);});
    const originalGrid = renderGrid;
    function compactConflicts() {
      const grid=$('weekGrid'), items=Array.from(grid.querySelectorAll('.week-course'));
      for(let day=2;day<=8;day++){
        const entries=items.map(item=>({item:item,area:item.style.gridArea.split('/').map(Number)}))
          .filter(entry=>entry.area[1]===day).sort((a,b)=>a.area[0]-b.area[0]);
        const groups=[];
        entries.forEach(entry=>{
          const group=groups[groups.length-1];
          if(group && entry.area[0]<group.end){group.entries.push(entry);group.end=Math.max(group.end,entry.area[2]);}
          else groups.push({entries:[entry],start:entry.area[0],end:entry.area[2]});
        });
        groups.forEach(group=>{
          if(group.entries.length===1){
            const item=group.entries[0].item;
            item.style.width='';item.style.marginLeft='';item.style.justifySelf='';
            return;
          }
          const choose=button('week-course conflict week-conflict-group','',()=>{
            conflictList.replaceChildren(...group.entries.map(entry=>{
              const option=button('button button-outline','',()=>{closeDialog(conflictDialog);entry.item.click();});
              option.textContent=entry.item.getAttribute('aria-label');return option;
            }));
            showDialog(conflictDialog);
          });
          choose.style.gridArea=group.start+' / '+day+' / '+group.end+' / '+(day+1);
          choose.append(node('strong','course-name',group.entries.length+' 门课程'),node('small','course-room','时间冲突 · 点开选择'));
          choose.setAttribute('aria-label',group.entries.length+' 门课程时间冲突，点开选择：'+group.entries.map(entry=>entry.item.getAttribute('aria-label')).join('；'));
          group.entries.forEach(entry=>entry.item.remove());grid.append(choose);
        });
      }
    }
    renderGrid = function () {
      const result = originalGrid();
      compactConflicts();
      const grid=$('weekGrid');
      grid.style.gridTemplateRows='48px repeat('+grid.querySelectorAll('.grid-time').length+',76px)';
      $('weekGrid').querySelectorAll('.week-course').forEach(item => {
        // The full label remains available to assistive technology and the detail dialog.
        item.dataset.fullLabel = item.getAttribute('aria-label');
      });
      return result;
    };
  })();
