var hash = require('./hash');

// default timer settings, in seconds
var timers = {
    inactiveOut: 10,
    activeOut: 200
}

// global hash of all known switches by ipp or hash
var network = {};

// callbacks must be set first, and must have .data({telex for app}) and .send("ipp", {telex})
var master = {data:function(){}, send:function(){}};
exports.setCallbacks = function(m)
{
    master = m;
}

// return array of all
function getSwitches()
{
    var arr = [];
    Object.keys(network).forEach(function(key){
        if(network[key].id == key) arr.push(network[key]);
    });
    return arr;
}
exports.getSwitches = getSwitches;

function getSwitch(ipp)
{
    if(network[ipp]) return network[ipp];
    return new Switch(ipp);
    // create new one!
}
exports.getSwitch = getSwitch;

// return array of switches closest to the hash, s (optional optimized staring switch), num (default 5, optional)
function getNear(hash, s, num)
{

}
exports.getNear = getNear;

// every seen IPP becomes a switch object that maintains itself
function Switch(ipp)
{
    this.ipp = ipp;
    this.hash = new hash.Hash(ipp);
    this.id = this.hash.toString();
    network[this.ipp] = network[this.id] = this;
    this.active = false;
    this.tInactive = setTimeout(this.inactiveOut, timers.inactiveOut*1000);
    return this;
}
exports.Switch = Switch;


// process incoming telex from this switch
Switch.prototype.incoming = function(telex)
{
    if(validate(s, telex))
    if(this.active) this.queue.push(telex);
}

Switch.prototype.process = function(telex, callback)
{

}

// clean up
Switch.prototype.inactiveOut = function()
{

}

Switch.prototype.destruct = function()
{
    // delete self, if active try to send goodbye
}

// handle own timer to send pings and clean up if dissappeared

// recursive find closer

function activate(s)
{
    s.active = true;
    clearTimeout(s.tInactive);
    network[s.ipp] = network[s.id] = s;
    s.queue = async.queue(s.process, 1);
    // adjust timers
}