(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SuikeWeekGesture=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create(options){
    const holdMs=500,slop=8;let gesture=null,timer=null;
    const schedule=options.schedule||setTimeout,unschedule=options.unschedule||clearTimeout;
    function clear(){if(timer!==null)unschedule(timer);timer=null;}
    function cancel(reason){clear();const old=gesture;gesture=null;if(old&&old.active&&options.onCancel)options.onCancel(reason||'cancel');}
    return {
      holdMs,
      start(candidate,point,pointerId){cancel('restart');gesture={candidate,point:{...point},origin:{...point},pointerId,active:false};const current=gesture;
        timer=schedule(()=>{timer=null;if(gesture!==current)return;current.active=true;if(options.onActivate(current.candidate,current.point)===false)cancel('unavailable');},holdMs);
      },
      move(point,pointerId){if(!gesture||gesture.pointerId!==pointerId)return;gesture.point={...point};
        if(!gesture.active){if(Math.hypot(point.x-gesture.origin.x,point.y-gesture.origin.y)>slop)cancel('scroll');return;}
        options.onMove(point);
      },
      end(point,pointerId){if(!gesture||gesture.pointerId!==pointerId)return;clear();const old=gesture;gesture=null;if(old.active)options.onDrop(point);},
      cancel,
      get phase(){return !gesture?'idle':gesture.active?'dragging':'pending';},
      get pointerId(){return gesture?gesture.pointerId:null;}
    };
  }
  return {create};
});
