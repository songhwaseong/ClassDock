"use strict";
/* DOM 없는 관측 이력. 동일 좌표/캐시를 새로운 움직임으로 취급하지 않는다. */
const MNJejuBusLive = (() => {
  function metres(a,b){
    const rad=Math.PI/180, dy=(b[0]-a[0])*rad, dx=(b[1]-a[1])*rad;
    const h=Math.sin(dy/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dx/2)**2;
    return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  function prepareShape(points){
    if (!Array.isArray(points) || points.length<2) return null;
    const lengths=[0],breaks=new Set(),segments=[];let segment=[points[0]];
    for(let i=1;i<points.length;i++){
      const length=metres(points[i-1],points[i]);
      if (!Number.isFinite(length)) return null;
      if(length>500){breaks.add(i);if(segment.length>1)segments.push(segment);segment=[];}
      segment.push(points[i]);
      lengths.push(lengths[i-1]+length);
    }
    if(segment.length>1)segments.push(segment);
    return segments.length?{points,lengths,breaks,segments}:null;
  }
  function project(shape,at){
    if (!shape) return null;
    const scale=Math.cos(at[0]*Math.PI/180), candidates=[];
    for(let i=1;i<shape.points.length;i++){
      if(shape.breaks.has(i))continue;
      const a=shape.points[i-1],b=shape.points[i],x=(b[1]-a[1])*scale,y=b[0]-a[0],size=x*x+y*y;
      if (!size) continue;
      const t=Math.max(0,Math.min(1,((at[1]-a[1])*scale*x+(at[0]-a[0])*y)/size));
      const point=[a[0]+t*y,a[1]+t*(b[1]-a[1])],distance=metres(at,point);
      if (distance<=40) candidates.push({point,distance,index:i,along:shape.lengths[i-1]+t*(shape.lengths[i]-shape.lengths[i-1])});
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    const best=candidates[0];
    if (!best || candidates.some(c=>Math.abs(c.along-best.along)>150 && c.distance<=best.distance+15)) return null;
    return best;
  }
  function transition(shape,a,b,elapsed){
    if (!shape || elapsed<=0 || elapsed>90000) return null;
    const from=project(shape,a),to=project(shape,b);
    if (!from || !to) return null;
    const length=to.along-from.along;
    if ([...shape.breaks].some(i=>i>=from.index && i<=to.index))return null;
    if (length<=0 || length>1500 || length/(elapsed/1000)>100/3.6) return null;
    const path=[a,from.point];
    for(let i=from.index;i<to.index;i++) path.push(shape.points[i]);
    path.push(to.point,b);
    return path;
  }
  function pathAt(path,ratio){
    const lengths=path.slice(1).map((p,i)=>metres(path[i],p));
    let remaining=lengths.reduce((a,b)=>a+b,0)*ratio;
    for(let i=0;i<lengths.length;i++){
      if (remaining<=lengths[i]){
        const t=lengths[i]?remaining/lengths[i]:1;
        return path[i].map((v,j)=>v+(path[i+1][j]-v)*t);
      }
      remaining-=lengths[i];
    }
    return path[path.length-1];
  }
  function create(){return {routeKey:"",fetchedAt:0,vehicles:new Map()};}
  function ingest(state,response,now,shape,animate=true){
    if (state.routeKey && state.routeKey!==response.routeKey || response.fetchedAt<=state.fetchedAt) return false;
    state.routeKey=response.routeKey;state.fetchedAt=response.fetchedAt;
    if (!response.vehicles.length){state.vehicles.clear();return true;}
    const alive=new Set();
    for(const row of response.vehicles){
      alive.add(row.id);
      const old=state.vehicles.get(row.id),changed=old && (old.at[0]!==row.at[0] || old.at[1]!==row.at[1]);
      const path=changed && animate && now-response.fetchedAt<60000 ? transition(shape,old.at,row.at,response.fetchedAt-old.lastSeenAt):null;
      state.vehicles.set(row.id,{...row,missing:0,lastSeenAt:response.fetchedAt,
        coordinateSince:!old || changed?response.fetchedAt:old.coordinateSince,
        lastCoordinateChangedAt:changed?response.fetchedAt:old?old.lastCoordinateChangedAt:null,
        stationPending:!!(old && !changed && (old.stationPending || old.stationId!==row.stationId || old.stationName!==row.stationName)),
        animation:path?{path,start:now,end:now+1800}:null,
        relocatedAt:changed && !path?now:0});
    }
    for(const [id,vehicle] of state.vehicles) if (!alive.has(id) && ++vehicle.missing>=2) state.vehicles.delete(id);
    return true;
  }
  function view(vehicle,now,reduced=false){
    const age=Math.max(0,now-vehicle.lastSeenAt);
    if (age>=300000) return null;
    const anim=vehicle.animation,moving=!reduced && anim && now<anim.end;
    return {at:moving?pathAt(anim.path,Math.max(0,(now-anim.start)/(anim.end-anim.start))):vehicle.at,
      moving:!!moving,dim:age>=120000 || vehicle.missing>0,
      status:vehicle.missing?"차량 정보 갱신 대기":age>=120000?"정보 수신 지연":vehicle.stationPending?"정류장 정보 갱신 · 위치 갱신 대기"
        :now-vehicle.coordinateSince>=90000?"위치 변화 확인 안 됨":"마지막 수신 위치"};
  }
  return {metres,prepareShape,project,transition,create,ingest,view};
})();
if (typeof module!=="undefined" && module.exports) module.exports=MNJejuBusLive;
