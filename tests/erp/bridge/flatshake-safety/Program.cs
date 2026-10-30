using System;
using System.Collections;
using OpenDeploy.BosBridge;
using Kingdee.BOS.ServiceFacade;

// Synthetic reflection target: no vendor assemblies, credentials, sockets or ERP.
namespace Kingdee.BOS.ServiceFacade
{
    public static class XmlSerializerProxy
    {
        public static IDictionary? _ChkSumCodeHandlers = new Hashtable();
        public static int FallbackCalls;
        public static string GenCheckSumCodeDynLen_TwoSix(string a, string b, string c, string d, string e)
        {
            FallbackCalls++;
            return "unverified-2.6-checksum";
        }
    }
}

internal static class SafetyTests
{
    private delegate string Handler(string data, string algo, string timestamp, string nonce, string seed, string version);
    private static int passed;

    private static string Compute(string version = "2.5") => BosContext.ComputeFlatShakeViaHandler(
        "synthetic-data", "SHA256", "synthetic-time", "synthetic-nonce", "synthetic-seed", version);

    private static void Check(bool condition)
    {
        if (!condition) throw new Exception("Synthetic FlatShake safety assertion failed");
    }

    private static void Reject(Action setup, string version = "2.5")
    {
        setup();
        bool rejected = false;
        try { Compute(version); }
        catch { rejected = true; }
        Check(rejected);
        Check(XmlSerializerProxy.FallbackCalls == 0);
        passed++;
    }

    private static int Main()
    {
        Handler exact = (data, algo, timestamp, nonce, seed, version) =>
        {
            Check(data == "synthetic-data" && algo == "SHA256" && timestamp == "synthetic-time"
                && nonce == "synthetic-nonce" && seed == "synthetic-seed" && version == "2.5");
            return "synthetic-checksum";
        };
        XmlSerializerProxy._ChkSumCodeHandlers = new Hashtable { ["2.5"] = exact };
        Check(Compute() == "synthetic-checksum");
        Check(XmlSerializerProxy.FallbackCalls == 0);
        passed++;
        Reject(() => XmlSerializerProxy._ChkSumCodeHandlers = new Hashtable { ["2.6"] = exact });
        Reject(() => XmlSerializerProxy._ChkSumCodeHandlers = new Hashtable { ["default"] = exact });
        Reject(() => XmlSerializerProxy._ChkSumCodeHandlers = null);
        Reject(() => XmlSerializerProxy._ChkSumCodeHandlers = new Hashtable { ["2.5"] = null });
        Reject(() => XmlSerializerProxy._ChkSumCodeHandlers = new Hashtable { ["2.5"] = new object() });
        Reject(() => XmlSerializerProxy._ChkSumCodeHandlers = new Hashtable {
            ["2.5"] = new Func<string>(() => "wrong-signature") });
        Reject(() => XmlSerializerProxy._ChkSumCodeHandlers = new Hashtable {
            ["2.5"] = new Handler((a, b, c, d, e, f) => " ") });
        Reject(() => XmlSerializerProxy._ChkSumCodeHandlers = new Hashtable {
            ["2.5"] = new Handler((a, b, c, d, e, f) => throw new Exception("synthetic-private-detail")) });
        Reject(() => XmlSerializerProxy._ChkSumCodeHandlers = new Hashtable(), "2.6");
        Console.WriteLine($"{passed} synthetic FlatShake safety cases passed");
        return 0;
    }
}
