
var hashname = require('hashname');
var base32 = hashname.base32;

module.exports = {
  loadMeshJSON : loadMeshJSON
}


/** load a hashname and other parameters into our json format
 * @param {hashname} hn
 * @param {object} args - a hash with key, keys, and csid params
 * @return {object} json - the populated json
 */
function loadMeshJSON(mesh,hashname, args){
  // add/get json store
  var json = mesh.json_store[hashname];
  if(!json)
    json = mesh.json_store[hashname] = {hashname:hashname,paths:[],keys:{}};

  if(args.keys)
    json.keys = args.keys;

  // only know a single csid/key
  if(args.csid && args.key)
  {
    json.keys[args.csid] = args.key;
  }

  // make sure no buffers
  Object.keys(json.keys).forEach(function(csid){
    if(Buffer.isBuffer(json.keys[csid]))
      json.keys[csid] = base32.encode(json.keys[csid]);
  });

  return json;
}
