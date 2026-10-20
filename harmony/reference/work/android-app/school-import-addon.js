  // Twelve-section schools add only their extra options; the original 8/10 UI stays intact.
  (function installSchoolPeriodOptions(){
    const previous=render;
    render=function(){
      const result=previous();
      ['start','end'].forEach(name=>{
        const input=$('courseForm').elements.namedItem(name),limit=state.periods.length;
        Array.from(input.children).forEach(option=>{if(Number(option.value)>limit)option.remove();});
        for(let n=11;n<=limit;n++)if(!Array.from(input.children).some(option=>option.value===String(n))){
          const option=node('option','','第 '+n+' 节 · '+state.periods[n-1][name==='start'?'start':'end']);option.value=String(n);input.append(option);
        }
      });
      return result;
    };
  })();
