var fs = require('fs');

// we just wrap the shared code
var telehash = module.exports = require('./lib/mesh.js');
var log = telehash.log();

// node specific extensions
module.exports.add(require('telehash-udp4'));
module.exports.add(require('telehash-http'));
module.exports.add(require('telehash-tcp4'));

// wrap the mesh to accept file-based args
module.exports.load = function(args, cbMesh)
{
  var idFile, linksFile;

  // set up some node-specific things after the mesh is created
  function loaded(err)
  {
    if(err)
    {
      log.error(err);
      cbMesh(err);
      return false;
    }

    return telehash.mesh(args, function(err, mesh){
      if(!mesh) return cbMesh(err);

      // sync links automatically to file whenever they change
      if(linksFile) mesh.linked(function(json, str){
        log.debug('syncing links json',linksFile,str.length);
        fs.writeFileSync(linksFile, str);
      });

      cbMesh(err, mesh);
    });
  }

  if(typeof args.links == 'string')
  {
    linksFile = args.links;
    if(fs.existsSync(args.links))
    {
      log.debug('loading links',args.links);
      args.links = require(args.links);
    }
  }

  if(typeof args.id == 'string')
  {
    idFile = args.id;

    if(fs.existsSync(args.id))
    {
      log.debug('loading id',args.id);
      args.id = require(args.id);
      return loaded();
    }

    // create new
    log.debug('generating new id');
    telehash.generate(function(err,id){
      if(err) return loaded(err);
      args.id = id;
      log.debug('saving to',idFile);
      fs.writeFile(idFile, JSON.stringify(id, null, 4), loaded);
    });

    return;
  }
  
  // default passthrough
  return loaded();
}
