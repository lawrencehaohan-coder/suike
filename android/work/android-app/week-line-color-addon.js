  // Named legacy palette values keep the default monochrome line. Explicit
  // #RRGGBB choices are already supported by validation, backups and imports.
  let weekLineDraft={base:'teal',custom:false};
  function weekLineFormColor(value){return weekLineDraft.custom?value:weekLineDraft.base;}
  (function installWeekLineColor(){
    const form=$('courseForm'),picker=form.elements.namedItem('color');
    const custom=value=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value);
    const defaultInk=()=>state.settings.theme==='dark'||state.settings.theme==='auto'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'#ffffff':'#000000';
    const originalEdit=openEdit;
    openEdit=function(course){
      originalEdit(course);weekLineDraft={base:course?course.color:'teal',custom:!!course&&custom(course.color)};
      picker.value=weekLineDraft.custom?course.color:defaultInk();
    };
    function choose(){weekLineDraft.custom=true;}
    picker.addEventListener('input',choose);picker.addEventListener('change',choose);
    const reset=button('text-button','恢复默认黑白',()=>{weekLineDraft={base:'teal',custom:false};picker.value=defaultInk();});
    reset.id='resetWeekLineColor';picker.parentElement.append(reset);
  })();
