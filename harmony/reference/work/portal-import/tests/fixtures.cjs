// Entirely synthetic fixtures. No university HTML, identity, sessions or real teachers.
function hhu(){return {source:'hhu-jsxsd-table',adapterVersion:1,term:{year:'2026-2027',semester:'1'},unscheduledPresent:false,periodGroups:[
  {group:1,first:1,last:2,start:'08:00',end:'09:35'},
  {group:2,first:3,last:5,start:'09:50',end:'12:15'},
  {group:3,first:6,last:7,start:'14:00',end:'15:35'},
  {group:4,first:8,last:9,start:'15:50',end:'17:25'},
  {group:5,first:10,last:12,start:'18:30',end:'20:55'}],rows:[
  {cell:'1-1',name:'合成高等数学',weekText:'1-16(周)[1-2节]',room:'测试楼 101',teacher:'测试教师甲'},
  {cell:'2-2',name:'合成物理',weekText:'1-16(单周)[3-4-5节]',room:'测试楼 102',teacher:'测试教师乙'},
  {cell:'5-5',name:'合成晚课',weekText:'9,10,12(周)[10-11-12节]',room:'测试楼 103',teacher:'测试教师丙'}]};}
function njust(){const value=hhu();value.source='njust-jsxsd-table';value.periodGroups=[];value.rows[1].weekText='1-16(单周)[3-4节]';return value;}
module.exports={hhu,njust};
