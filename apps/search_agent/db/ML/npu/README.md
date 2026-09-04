## Requirements
https://ryzenai.docs.amd.com/en/latest/inst.html
activate the created conda environment
then, ideally fix the current environment (its usually pretty fragile)
```bash
pip freeze > constraints.txt 
```

and install extra db requirements (see this folder):
``` bash
pip install -r requirements.txt -c constraints.txt
```


## Workflow
export_fixed.py 
-> quantize_model.py 
-> benchmark.py (check that theres enough variance in the embeddings and how fast the model runs) 
-> seed.py