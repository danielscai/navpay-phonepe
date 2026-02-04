package com.phonepe.checksumclient

import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import com.phonepe.checksumclient.databinding.ActivityMainBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val client = OkHttpClient()
    private val jsonMedia = "application/json".toMediaType()
    private val tag = "PPChecksumClient"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.healthBtn.setOnClickListener {
            runRequest("health", "http://127.0.0.1:19090/health", JSONObject())
        }

        binding.checksumBtn.setOnClickListener {
            val path = binding.pathInput.text?.toString()?.trim().orEmpty()
            val body = binding.bodyInput.text?.toString() ?: ""
            val uuid = binding.uuidInput.text?.toString()?.trim().orEmpty()
            val payload = JSONObject().apply {
                put("path", path)
                put("body", body)
                put("uuid", uuid)
            }
            runRequest("checksum", "http://127.0.0.1:19090/checksum", payload)
        }

        // Auto-run once on launch to validate connectivity.
        autoTest()
    }

    private fun autoTest() {
        CoroutineScope(Dispatchers.IO).launch {
            runRequest("health", "http://127.0.0.1:19090/health", JSONObject())
            val path = binding.pathInput.text?.toString()?.trim().orEmpty()
            val body = binding.bodyInput.text?.toString() ?: ""
            val uuid = binding.uuidInput.text?.toString()?.trim().orEmpty()
            val payload = JSONObject().apply {
                put("path", path)
                put("body", body)
                put("uuid", uuid)
            }
            runRequest("checksum", "http://127.0.0.1:19090/checksum", payload)
        }
    }

    private fun runRequest(label: String, url: String, payload: JSONObject) {
        runOnUiThread { binding.outputView.text = "Loading..." }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val body = payload.toString().toRequestBody(jsonMedia)
                val req = Request.Builder()
                    .url(url)
                    .post(body)
                    .build()
                val resp = client.newCall(req).execute()
                val text = resp.body?.string() ?: ""
                val pretty = try {
                    JSONObject(text).toString(2)
                } catch (e: Exception) {
                    text
                }
                Log.i(tag, "$label status=${resp.code}")
                runOnUiThread {
                    binding.outputView.text = "HTTP ${resp.code}\n$pretty"
                }
            } catch (e: Exception) {
                Log.e(tag, "$label error: ${e.message}", e)
                runOnUiThread {
                    binding.outputView.text = "ERROR: ${e.message}"
                }
            }
        }
    }
}
