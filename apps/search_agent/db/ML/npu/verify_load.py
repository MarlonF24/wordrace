import os
import time
import numpy as np
import onnxruntime as ort

"""
Tests whether NPU actually loads and runs the model. 
"""
def verify_npu_load():
    # Path to the test model provided by Ryzen AI
    install_path = os.environ.get('RYZEN_AI_INSTALLATION_PATH', r'C:\Program Files\RyzenAI\1.7.1')
    model_path = os.path.join(install_path, 'quicktest', 'test_model.onnx')

    # Define providers, forcing VitisAI first
    providers = ['VitisAIExecutionProvider', 'CPUExecutionProvider']

    print("Initializing session...")
    session = ort.InferenceSession(model_path, providers=providers)

    # Check which providers actually loaded
    print(f"Active Providers: {session.get_providers()}")

    input_name = session.get_inputs()[0].name
    input_shape = session.get_inputs()[0].shape

    # Resolve symbolic dimensions (strings) to valid integers
    resolved_shape = [dim if isinstance(dim, int) else 1 for dim in input_shape]
    dummy_input = np.random.randn(*resolved_shape).astype(np.float32)

    print("Starting 10-second NPU load test... Check Task Manager now!")
    end_time = time.time() + 10
    count = 0

    while time.time() < end_time:
        session.run(None, {input_name: dummy_input})
        count += 1

    print(f"Test finished. Ran {count} inferences.")
if __name__ == "__main__":
    verify_npu_load()