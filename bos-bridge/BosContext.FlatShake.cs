using System;
using System.Collections;
using System.Reflection;
using System.Text;

namespace OpenDeploy.BosBridge
{
    /// <summary>
    /// FlatShake request checksum (the `pvfgsdhsfg` HTTP header).
    ///
    /// K/3 Cloud V9.1 enables a challenge/anti-tamper mechanism the server
    /// advertises via the `pvfgsdhsfg_cfg` response header on the first
    /// unauthenticated call (e.g. GetMCInfoByClient):
    ///   {"enableFlatShake":true,"checksumvn":"2.5", ...}
    /// The client must then attach a `pvfgsdhsfg` request header computed
    /// with the server's own serializer pipeline (XmlSerializerProxy +
    /// Kingdee.BOS.SerializatonUtil). OpenDeploy cannot implement this in
    /// TS without the private crypto helpers, so it delegates here — the
    /// same sidecar pattern as DcxmlSerializer.
    ///
    /// The transformation is versioned: handler dictionaries keyed by
    /// checksumvn ("2.1".."2.6","default"). We drive the registered
    /// `Func<...>` delegate for the requested vn via reflection so the
    /// exact algorithm (including the SmartAssembly-obfuscated string
    /// constants) stays inside the vendor DLL.
    /// </summary>
    internal sealed partial class BosContext
    {
        private const string SerializerProxyTypeName =
            "Kingdee.BOS.ServiceFacade.XmlSerializerProxy, Kingdee.BOS.ServiceFacade.Common";

        /// <summary>
        /// Compute the `pvfgsdhsfg` request-header value for the given
        /// FlatShake version by driving the vendor's registered checksum
        /// handler (most faithful). Falls back to GenCheckSumCodeDynLen_TwoSix.
        /// </summary>
        /// <param name="data">target payload (request body / ap fields).</param>
        /// <param name="hashingAlgoType">e.g. "SHA256".</param>
        /// <param name="timestamp">server-local timestamp string.</param>
        /// <param name="nonce">client nonce.</param>
        /// <param name="ccsDt">challenge seed (previous server pvfgsdhsfg).</param>
        /// <param name="vn">checksumvn from pvfgsdhsfg_cfg, e.g. "2.5".</param>
        public static string ComputeFlatShakeViaHandler(
            string data, string hashingAlgoType, string timestamp, string nonce, string ccsDt, string vn)
        {
            var type = Type.GetType(SerializerProxyTypeName, throwOnError: false)
                ?? throw new InvalidOperationException(
                    "XmlSerializerProxy type not found — is Kingdee.BOS.ServiceFacade.Common.dll loadable?");
            var flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance | BindingFlags.FlattenHierarchy;

            // Try the registered handler dictionary first (same code the
            // vendor client executes for the negotiated checksumvn).
            var handlersField = type.GetField("_ChkSumCodeHandlers", flags);
            if (handlersField?.GetValue(null) is IDictionary dict && dict.Contains(vn))
            {
                var handler = dict[vn];
                var invoke = handler.GetType().GetMethod("Invoke");
                var result = invoke?.Invoke(handler, new object?[] { data, hashingAlgoType, timestamp, nonce, ccsDt, vn });
                if (result is string s) return s;
            }

            // Fallback: direct static call.
            var gen = type.GetMethod("GenCheckSumCodeDynLen_TwoSix", flags)
                ?? throw new InvalidOperationException("GenCheckSumCodeDynLen_TwoSix not found");
            var direct = gen.Invoke(null, new object?[] { data, hashingAlgoType, timestamp, nonce, ccsDt });
            return direct as string ?? throw new InvalidOperationException("GenCheckSumCodeDynLen_TwoSix returned null");
        }
    }
}
