package com.phonepe.checksumclient

import android.os.Bundle
import android.view.View
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.phonepe.checksumclient.databinding.FragmentProfileBinding
import kotlinx.coroutines.launch

class ProfileFragment : Fragment(R.layout.fragment_profile) {
    interface Callback {
        fun onLogout()
    }

    private var _binding: FragmentProfileBinding? = null
    private val binding get() = _binding!!
    private lateinit var authManager: AuthManager
    private lateinit var apiClient: ApiClient
    private var currentPhone: String = ""

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        _binding = FragmentProfileBinding.bind(view)
        authManager = AuthManager(requireContext())
        apiClient = ApiClient(authManager)

        binding.profileSave.setOnClickListener { saveProfile() }
        binding.profileLogout.setOnClickListener { logout() }

        loadProfile()
    }

    private fun loadProfile() {
        val username = authManager.getUsername().orEmpty()
        binding.profileUsername.text = "Username: $username"
        if (!authManager.isTokenValid()) {
            binding.profileStatus.text = "Not logged in"
            return
        }
        binding.profileStatus.text = "Loading..."
        lifecycleScope.launch {
            try {
                val profile = apiClient.getProfile()
                binding.displayNameInput.setText(profile.name)
                binding.emailInput.setText(profile.email)
                currentPhone = profile.phone
                binding.profileStatus.text = "Loaded"
            } catch (e: Exception) {
                if (e is AuthException) {
                    if (e.shouldLogout) {
                        (activity as? Callback)?.onLogout()
                    } else {
                        binding.profileStatus.text = "Session expired on server. Please re-login."
                    }
                    return@launch
                }
                binding.profileStatus.text = e.message ?: "Load failed"
            }
        }
    }

    private fun saveProfile() {
        if (!authManager.isTokenValid()) {
            binding.profileStatus.text = "Not logged in"
            return
        }
        val name = binding.displayNameInput.text?.toString()?.trim().orEmpty()
        val email = binding.emailInput.text?.toString()?.trim().orEmpty()
        val phone = currentPhone
        binding.profileStatus.text = "Saving..."
        lifecycleScope.launch {
            try {
                val profile = apiClient.updateProfile(name, phone, email)
                binding.displayNameInput.setText(profile.name)
                binding.emailInput.setText(profile.email)
                binding.profileStatus.text = "Saved"
            } catch (e: Exception) {
                if (e is AuthException) {
                    if (e.shouldLogout) {
                        (activity as? Callback)?.onLogout()
                    } else {
                        binding.profileStatus.text = "Session expired on server. Please re-login."
                    }
                    return@launch
                }
                binding.profileStatus.text = e.message ?: "Save failed"
            }
        }
    }

    private fun logout() {
        lifecycleScope.launch {
            try {
                apiClient.logout()
            } catch (_: Exception) {
            }
            authManager.clear()
            (activity as? Callback)?.onLogout()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
