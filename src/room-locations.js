import { sameCell, cellKey, positionOf, tileAt } from './spatial.js';

// Local room cells remain x,y keys, scoped by one explicit room deck.
// Omitted z is accepted only by this adapter for pre-migration/pure fixtures.
export const roomLevel = room => room.z === undefined ? 0 : room.z;
export const roomCellPosition = (room,key) => {const [x,y]=key.split(',').map(Number);return {x,y,z:roomLevel(room)};};
export const roomCellKey = (room,key) => cellKey(roomCellPosition(room,key));
export const roomAtPosition = (site,p) => sameCell(p,p) ? site.rooms.find(r=>roomLevel(r)===p.z&&r.cells.includes(`${p.x},${p.y}`)) : undefined;
export function validateRoomLocations(s,{legacy=false}={}) {
  for(const site of Object.values(s.sites))for(const room of site.rooms) {
    if(legacy?Object.hasOwn(room,'z'):!site.levels?.some(level=>level.z===room.z))throw new Error('Invalid '+(legacy?'legacy ':'')+'room deck.');
  }
}
export function migrateRoomLocations(s) {
  for(const site of Object.values(s.sites))for(const room of site.rooms)room.z=0;
}

export const roomContains = (room,p) => !!room && roomLevel(room)===positionOf(p).z && room.cells.includes(`${p.x},${p.y}`);
export const roomTiles = (site,room) => room.cells.map(key=>tileAt(site,roomCellPosition(room,key)));
export function validateDesignationLocations(s,{legacy=false}={}) {
  for(const site of Object.values(s.sites)) {
    if(!Array.isArray(site.designations))throw new Error('Invalid room designations.');
    for(const d of site.designations)
      if(!d||(legacy?Object.hasOwn(d,'z'):!Number.isSafeInteger(d.z))||!tileAt(site,{x:d.x,y:d.y,z:legacy?0:d.z}))
        throw new Error('Invalid '+(legacy?'legacy ':'')+'room designation location.');
  }
}
export function migrateDesignationLocations(s) {
  for(const site of Object.values(s.sites))for(const d of site.designations)d.z=0;
}
