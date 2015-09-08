var streamlib = require('stream');
var lob = require('lob-enc');
var net = require('net');

function getExternalIp() {
	var ifconfig = require('os').networkInterfaces();
	var device, i, I, protocol;

	for (device in ifconfig) {
		// ignore network loopback interface
		if (device.indexOf('lo') !== -1 || !ifconfig.hasOwnProperty(device)) {
			continue;
		}
		for (i=0, I=ifconfig[device].length; i<I; i++) {
			protocol = ifconfig[device][i];

			// filter for external IPv4 addresses
			if (protocol.family === 'IPv4' && protocol.internal === false) {
				console.log('found', protocol.address);
				return protocol.address;
			}
		}
	}

	return null;
}

// implements https://github.com/telehash/telehash.org/blob/v3/v3/channels/sock.md
exports.name = 'sock';

function openUDPSock(open, cbOpen){

}


exports.mesh = function(mesh, cbMesh)
{
  var ext = {open:{}};


  ext.link = function(link, cbLink)
  {

    // ask this link to create a socket to the given args.ip and args.port
    link.connect = function(args, cbMessage)
    {
      console.log("connect called")
      var open = {
        json:{
          type:'sock',
          sock: "connect",
          dst:{
            ip: args.ip,
            port: args.port
          }
        }
      };
      var TCP = !(typeof cbMessage === "function");

      if (TCP){
        open.json.seq = 1; // always reliable
        var channel = link.x.channel(open);
        var stream = mesh.streamize(channel,"binary")
        channel.send(open);
        console.log("stream")
        return stream;

      } else {
        console.log("UDP")
        var channel = link.x.channel(open);
        chan.receive = cbMessage;
        channel.send(open)
        return;
      }
      // if cbMessage is provided, create a UDP socket, otherwise return a stream
    }

    // ask the link to create a server for us, args.port and args.type is udp/tcp
    link.sock_bound = {};

    //
    link.server = function(args, cbAccept, cbServer)
    {
      link._cbAccept = cbAccept;
      link._cbServer = cbServer;
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


  function openTCPSock(link, open, cbOpen){
    var type = open.json.sock;
    var src = open.json.src;
    var dst = open.json.dst;
    console.log("openTCPSock", type, src, dst)


    var channel = link.x.channel(open);
    channel.receive(open); // actually opens it

    var socket;

    if ((type === "connect" ) && dst &&  dst.port){
      //simple stream piping proxy
      socket = new net.Socket();
      console.log("incoming connect")
      socket.connect(dst.port, dst.ip);
      socket.on("connect",function(){
        stream = mesh.streamize(channel);
        socket.pipe(stream).pipe(socket)
        cbOpen(null, stream);
      })
    } else if (type === "bind" && !(src && src.ip)){
      var port = dst.port || 0
      var server = net.createServer(function(c) {
        // create 'accept' open
        var address = c.address()
        var accept = {
          json: {
            type:'sock',
            sock: "accept",
            dst: {
              ip: getExternalIp(),
              port : port
            }, src: {
              ip: address.address
            }
          }
        }

        accept.json.seq = 1; // always reliable
        var accept_chan = link.x.channel(accept);
        var stream = mesh.streamize(accept_chan);
        accept_chan.send(accept);
        c.pipe(stream).pipe(c);
      });
      server.listen(port, function(err) { //'listening' listener
        if (err) return cbOpen(err);

        var port = server.address().port;
        // let 'em know we're bound
        channel.send({json:{dst:{ip: getExternalIp(),port : port }}});

      });
    } else if (type === "accept"){
      var accept_channel = link.x.channel(open);
      var stream = mesh.streamize(accept_channel);
      if (link._cbAccept)
        link._cbAccept(open.json.src, stream);
      else
        cbOpen("no accept handler");
    } else {
      console.log("invalid sock open")
    }
  }

  ext.open.sock = function(args, open, cbOpen){
    var link = this;


    if (open.json.seq)
      return openTCPSock(link, open, cbOpen)

    // any accept, check link.sock_bound and fire cbAccept, else policy
    cbPolicy(link, open, function(err){
      // perform open request
    })
  }

  cbMesh(undefined, ext);
}
