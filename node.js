var fs = require('fs');

// we just wrap the shared code
var telehash = module.exports = require('./telehash');
var log = telehash.log();

// networking
module.exports.add(require('telehash-udp4'));

// standard extensions
module.exports.add(require('./ext/path'));
module.exports.add(require('./ext/peer'));
module.exports.add(require('./ext/stream'));

// wrap the mesh to accept file-based args
module.exports.load = function(args, cbMesh)
{
  function loaded()
  {
    return telehash.mesh(args, cbMesh);
  }

  if(typeof args.links == 'string' && fs.existsSync(args.links))
  {
    log.debug('loading links',args.links);
    args.links = require(args.links);
  }

  if(typeof args.id == 'string')
  {
    if(fs.existsSync(args.id))
    {
      log.debug('loading id',args.id);
      args.id = require(args.id);
      loaded();
      return;
    }

    // create new
    log.debug('generating new id');
    telehash.generate(function(err,id){
      if(err)
      {
        log.error(err);
        cbMesh(err);
        return;
      }
      log.debug('saving to',args.id);
      fs.writeFileSync(args.id, JSON.stringify(id, null, 4));
      args.id = id;
      loaded();
    });
    return;
  }
  
  // default passthrough
  return loaded();
}


