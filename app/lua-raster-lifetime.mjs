/** Raster handles keep engine image IDs but acquire a new Lua generation when
 * ColorSpace conversion replaces their native image identity. */
export function createLuaRasterLifetime({refs,attached,doc}) {
  const epochs=new Map();let serial=0;
  const raster=value=>value.kind==='Image'&&value.docId&&!value.tilesetId;
  function identity(docId,imageId){const epoch=doc(docId).images[imageId]?.tilemap?0:epochs.get(docId)??0;return {key:`image:${JSON.stringify([docId,imageId,epoch])}`,epoch};}
  return {
    identity,
    retire(docId){
      epochs.set(docId,++serial);
      for(const [key,value] of refs)if(raster(value)&&value.docId===docId&&!doc(docId).images[value.imageId]?.tilemap){value.profileRetired=true;value.pixels=[];attached.delete(key);}
    },
    snapshot(){return {epochs:new Map(epochs),refs:new Map([...refs].filter(([,value])=>raster(value)))};},
    restore(snapshot){
      epochs.clear();for(const [key,value]of snapshot.epochs)epochs.set(key,value);
      for(const [key,value]of snapshot.refs)if(!refs.has(key))refs.set(key,value);
      for(const [key,value]of refs)if(raster(value)){
        let image;try{image=doc(value.docId).images[value.imageId];}catch{image=null;}
        if(image&&value.profileImageEpoch===(image.tilemap?0:epochs.get(value.docId)??0)){
          delete value.profileRetired;attached.set(key,value);
        }else{value.profileRetired=true;value.pixels=[];attached.delete(key);}
      }
    },
  };
}
