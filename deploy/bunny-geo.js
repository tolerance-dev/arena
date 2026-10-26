// The DNS edge script tolerance-geo in Bunny (Edge Scripting, script 99095): tolerance.cc, www and * are script
// records pointing at it. This copy is for reading; edits go in Bunny's dashboard or API, then here.
// tolerance.cc, www and *.tolerance.cc: Russia goes through the relay on Selectel (Russian ISPs choke connections
// to foreign hosting), everyone else, VPN users included, straight to the server on UpCloud. deploy/README.md.
export default function handleQuery(query) {
    var country = query.request.geoLocation.country;
    if (country === "RU") {
        return new ARecord("139.100.217.119", 60);
    }
    return new ARecord("81.27.103.131", 60);
}
