import numpy as np


def compute_similarity(a, b):
    if len(a) != len(b) or len(a) == 0:
        return -1.0
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


def match_against_known(
    target_embedding,
    known_embeddings,
    base_threshold,
    margin_threshold,
    confirmed_threshold,
    review_threshold,
    max_second_best_similarity,
):
    if not known_embeddings:
        return None, [], {"decision": "REJECT", "reason": "no_known_faces"}

    scores = []
    for known in known_embeddings:
        sim = compute_similarity(target_embedding, known["embedding"])
        scores.append({
            "employee_id": known["employee_id"],
            "name": known["name"],
            "similarity": round(sim, 4),
        })

    scores.sort(key=lambda x: x["similarity"], reverse=True)
    best = scores[0]
    second_best = scores[1] if len(scores) > 1 else {"similarity": 0.0}
    margin = best["similarity"] - second_best["similarity"]

    if best["similarity"] < base_threshold:
        decision = "REJECT"
        reason = f"similarity {best['similarity']:.2%} < threshold {base_threshold:.2%}"
    elif len(scores) > 1 and second_best["similarity"] > max_second_best_similarity:
        decision = "REJECT"
        reason = f"second-best {second_best['similarity']:.2%} > max {max_second_best_similarity:.2%}"
    elif margin < margin_threshold and len(scores) > 1:
        decision = "REJECT"
        reason = f"margin {margin:.2%} < min {margin_threshold:.2%} (ambiguous)"
    elif best["similarity"] >= confirmed_threshold:
        decision = "CONFIRMED"
        reason = f"similarity {best['similarity']:.2%} >= confirmed {confirmed_threshold:.2%}"
    elif best["similarity"] >= review_threshold:
        decision = "REVIEW"
        reason = f"similarity {best['similarity']:.2%} in review zone"
    else:
        decision = "REJECT"
        reason = "below review threshold"

    return best, scores, {"decision": decision, "reason": reason, "margin": round(margin, 4)}
