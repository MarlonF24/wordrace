
if __name__ == "__main__":
    from captum.attr import FeatureAblation

    from search_agent.search.deep_learn.cost_model import CostApproximation, COST_FEATURE_COUNT, EMBEDDING_DIMENSION, NUM_SELECTABLE_LEXICAL_KEYS, NUM_WINK_POS_TAGS
    import torch
    import numpy as np

    import torch

    # Define the sizes based on your code
    EMB_DIM = EMBEDDING_DIMENSION
    COST_FEATURE_COUNT = EMB_DIM * 4 + 3 + 1 + NUM_SELECTABLE_LEXICAL_KEYS + NUM_WINK_POS_TAGS

    # Initialize mask
    feature_mask = torch.zeros((1, COST_FEATURE_COUNT), dtype=torch.long)
    offset = 0
    group_id = 0

    # 1. Raw Endpoints
    feature_mask[:, offset : offset + EMB_DIM] = group_id # current_embedding
    offset += EMB_DIM; group_id += 1

    feature_mask[:, offset : offset + EMB_DIM] = group_id # target_embedding
    offset += EMB_DIM; group_id += 1

    # 2. Pair Interactions (Vector)
    feature_mask[:, offset : offset + EMB_DIM] = group_id # difference vector
    offset += EMB_DIM; group_id += 1

    feature_mask[:, offset : offset + EMB_DIM] = group_id # product vector
    offset += EMB_DIM; group_id += 1

    # 3. Pair Interactions (Scalar)
    feature_mask[:, offset] = group_id # cosine similarity
    offset += 1; group_id += 1

    feature_mask[:, offset] = group_id # euclidean distance
    offset += 1; group_id += 1

    feature_mask[:, offset] = group_id # dot product
    offset += 1; group_id += 1

    # 4. Graph & Search Constraints
    feature_mask[:, offset] = group_id # lemmatized
    offset += 1; group_id += 1

    feature_mask[:, offset : offset + NUM_SELECTABLE_LEXICAL_KEYS] = group_id # lexical_field_mask
    offset += NUM_SELECTABLE_LEXICAL_KEYS; group_id += 1

    feature_mask[:, offset:] = group_id # pos_mask


    model = CostApproximation()
    ablator = FeatureAblation(model)

    test_batch = torch.randn((1, COST_FEATURE_COUNT), dtype=torch.float32)

    cost_attributions = ablator.attribute(
        test_batch,
        feature_mask=feature_mask,
        target=0,  
    )

    reachability_attributions = ablator.attribute(
        test_batch,
        feature_mask=feature_mask,
        target=1,  
    )

    group_names = [
        "current_embedding", "target_embedding", 
        "difference_vector", "product_vector", 
        "cosine_similarity", "euclidean_distance", "dot_product",
        "lemmatized", "lexical_field_mask", "pos_mask"
    ]

    for i, name in enumerate(group_names):
        start_idx = (feature_mask[0] == i).nonzero(as_tuple=True)[0][0].item()
        
        cost_score = cost_attributions[0, start_idx].item()
        reach_score = reachability_attributions[0, start_idx].item()
        
        print(f"{name:20s} | Cost: {cost_score:>8.4f} | Reachability: {reach_score:>8.4f}")


