var streamlib = require('stream');
var lob = require('lob-enc');

// implements https://github.com/telehash/telehash.org/blob/v3/v3/channels/sock.md
exports.name = 'sock';

exports.mesh = function(mesh, cbMesh)
{
  var ext = {open:{}};

  ext.link = function(link, cbLink)
  {

    // ask this link to create a socket to the given args.ip and args.port
    link.connect = function(args, cbMessage)
    {
      // if cbMessage is provided, create a UDP socket, otherwise return a stream
    }
    
    // ask the link to create a server for us, args.port and args.type is udp/tcp
    link.sock_bound = {};
    link.server = function(args, cbAccept, cbServer)
    {
      // udp messages, fire cbAccept, cbServer returns a message method
      // if no cbServer, no bind request, is just default accept
    }
    
    // just like mesh.sock for incoming requests on this link only
    link.sock = function(cbPolicy)
    {
      
    }

    cbLink();
  }

  // process any incoming connect/bind requests
  mesh.sock = function(cbPolicy)
  {
  }
  
  ext.open.sock = function(args, open, cbOpen){
    var link = this;
    // any accept, check link.sock_bound and fire cbAccept, else policy
    cbPolicy(link, open, function(err){
      // perform open request
    })
  }

  cbMesh(undefined, ext);
}