import requests
import logging
import json
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

DATA_DIR = Path(__file__).parent / "static" / "data"


def _age_guidance(age_range: str) -> str:
    guidance = json.loads((DATA_DIR / "age_guidance.json").read_text(encoding="utf-8"))
    return guidance.get(age_range, "")


def call_zen(action: str, content: str, stage_prompt: str, api_key: str,
             model: str = "mimo-v2.5", age_range: str = "adult") -> str:
    url = "https://opencode.ai/zen/go/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    try:
        prompt_path = Path(__file__).parent / "prompts" / f"{action}.md"
        system_msg = prompt_path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        raise RuntimeError(f"Unknown action: {action}")

    guidance = _age_guidance(age_range)
    if guidance:
        system_msg = f"{guidance}\n\n{system_msg}"
    system_msg += f"\n\nStage context: {stage_prompt}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": content}
        ]
    }

    try:
        logger.info(f"Sending '{action}' request to OpenCode Zen API...")
        logger.info(f"Payload: {json.dumps(payload, indent=2)}")
        
        resp = requests.post(url, headers=headers, json=payload, timeout=30, verify=False)
        
        logger.info(f"Response status: {resp.status_code}")
        if resp.status_code != 200:
            logger.error(f"Response error body: {resp.text}")
            raise RuntimeError(f"API Error {resp.status_code}: {resp.text}")
        
        # We know it's 200 at this point, but keeping this for completeness if needed
        resp.raise_for_status()
        data = resp.json()
        
        suggestion = data["choices"][0]["message"]["content"].strip()
        logger.info(f"Successfully received suggestion ({len(suggestion)} chars)")
        logger.info(f"Suggestion: {suggestion}")
        
        return suggestion
    except RuntimeError:
        raise
    except Exception as e:
        logger.error(f"AI provider error: {str(e)}")
        raise RuntimeError(f"AI provider error: {str(e)}")

def generate_questions(stage_prompt: str, story_so_far: str, q_and_a: list, api_key: str,
                        model: str = "mimo-v2.5", age_range: str = "adult") -> list[str]:
    url = "https://opencode.ai/zen/go/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    system_msg = (
        "You are an expert storytelling guide. Your task is to guide the user in writing the next stage of their story. "
        "Ask questions that are easy to answer, quick, and cut to the point. "
        "Use a casual, conversational, and friendly tone in your questions. Avoid sounding overly formal or academic. "
        "Based on the stage context, the story so far, and the questions the user has already answered, decide if more information is needed to write a complete entry. "
        "If you have a full picture and no more questions are needed, output an empty JSON array []. "
        "If more questions are needed, generate 1 to 2 new thought-provoking questions. "
        "Output ONLY a valid JSON array of strings, e.g., [\"Question 1?\"], with no markdown formatting."
    )
    guidance = _age_guidance(age_range)
    if guidance:
        system_msg = f"{guidance}\n\n{system_msg}"

    qa_text = ""
    if q_and_a:
        qa_text = "\n\nUser's answers so far:\n" + "\n".join([f"Q: {item['q']}\nA: {item['a']}" for item in q_and_a])

    user_msg = f"Story so far:\n{story_so_far if story_so_far else '(Beginning of the story)'}\n\nStage context: {stage_prompt}{qa_text}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg}
        ]
    }

    try:
        logger.info(f"Sending 'questions' request to OpenCode Zen API...")
        resp = requests.post(url, headers=headers, json=payload, timeout=30, verify=False)
        
        logger.info(f"Response status: {resp.status_code}")
        if resp.status_code != 200:
            logger.error(f"Response error body: {resp.text}")
            raise RuntimeError(f"API Error {resp.status_code}: {resp.text}")
            
        resp.raise_for_status()
        data = resp.json()
        
        content = data["choices"][0]["message"]["content"].strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        questions = json.loads(content)
        if not isinstance(questions, list):
            raise ValueError("AI did not return a JSON array.")
        return questions
    except RuntimeError:
        raise
    except Exception as e:
        logger.error(f"AI provider error: {str(e)}")
        raise RuntimeError(f"AI provider error: {str(e)}")

def weave_answers(stage_prompt: str, story_so_far: str, q_and_a: list, api_key: str,
                   model: str = "mimo-v2.5", age_range: str = "adult") -> str:
    url = "https://opencode.ai/zen/go/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    system_msg = (
        "You are an expert storyteller. The user has answered a series of guiding questions for a specific stage of the Hero's Journey. "
        "Your task is to weave their answers into a cohesive, well-written narrative passage for this stage. "
        "Use their ideas directly, adopting a descriptive and engaging tone that matches the story so far. "
        "Output only the narrative text, no extra commentary."
    )
    guidance = _age_guidance(age_range)
    if guidance:
        system_msg = f"{guidance}\n\n{system_msg}"

    qa_text = "\n".join([f"Q: {item['q']}\nA: {item['a']}" for item in q_and_a])
    user_msg = f"Story so far:\n{story_so_far if story_so_far else '(Beginning of the story)'}\n\nStage context: {stage_prompt}\n\nUser's Q&A:\n{qa_text}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg}
        ]
    }

    try:
        logger.info(f"Sending 'weave' request to OpenCode Zen API...")
        resp = requests.post(url, headers=headers, json=payload, timeout=30, verify=False)
        
        logger.info(f"Response status: {resp.status_code}")
        if resp.status_code != 200:
            logger.error(f"Response error body: {resp.text}")
            raise RuntimeError(f"API Error {resp.status_code}: {resp.text}")
            
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
    except RuntimeError:
        raise
    except Exception as e:
        logger.error(f"AI provider error: {str(e)}")
        raise RuntimeError(f"AI provider error: {str(e)}")
