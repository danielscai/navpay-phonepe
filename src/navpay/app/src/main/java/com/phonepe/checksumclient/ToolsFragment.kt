package com.phonepe.checksumclient

import android.os.Bundle
import android.util.Log
import android.view.View
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.phonepe.checksumclient.databinding.FragmentToolsBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class ToolsFragment : Fragment(R.layout.fragment_tools) {
    private var _binding: FragmentToolsBinding? = null
    private val binding get() = _binding!!
    private val client = OkHttpClient()
    private val jsonMedia = "application/json".toMediaType()
    private val tag = "NavPayTools"

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        _binding = FragmentToolsBinding.bind(view)

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
                if (uuid.isNotEmpty()) put("uuid", uuid)
            }
            runRequest("checksum", "http://127.0.0.1:19090/checksum", payload)
        }
    }

    private fun runRequest(label: String, url: String, payload: JSONObject) {
        if (!isAdded) return
        binding.outputView.text = "Loading..."
        viewLifecycleOwner.lifecycleScope.launch(Dispatchers.IO) {
            try {
                val req = Request.Builder()
                    .url(url)
                    .post(payload.toString().toRequestBody(jsonMedia))
                    .build()
                val resp = client.newCall(req).execute()
                val text = resp.body?.string() ?: ""
                val pretty = try {
                    JSONObject(text).toString(2)
                } catch (_: Exception) {
                    text
                }
                Log.i(tag, "$label status=${resp.code}")
                activity?.runOnUiThread {
                    if (isAdded) {
                        binding.outputView.text = "HTTP ${resp.code}\n$pretty"
                    }
                }
            } catch (e: Exception) {
                Log.e(tag, "$label error", e)
                activity?.runOnUiThread {
                    if (isAdded) {
                        binding.outputView.text = "ERROR: ${e.message}"
                    }
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
