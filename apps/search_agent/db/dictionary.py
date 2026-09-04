from typing import Optional
import enum

from sqlalchemy import CheckConstraint, Computed, Enum, Identity, Index, Integer, PrimaryKeyConstraint, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass


class SelectableLexicalKey(str, enum.Enum):
    ANTONYMS = 'antonyms'
    SYNONYMS = 'synonyms'
    HYPERNYMS = 'hypernyms'
    HYPONYMS = 'hyponyms'
    HOLONYMS = 'holonyms'
    MERONYMS = 'meronyms'
    DERIVED = 'derived'
    RELATED = 'related'
    COORDINATE_TERMS = 'coordinate_terms'
    GLOSSES = 'glosses'
    EXAMPLES = 'examples'
    CATEGORIES = 'categories'


class WiktionaryPosTag(str, enum.Enum):
    PHRASE = 'phrase'
    ADV_PHRASE = 'adv_phrase'
    SUFFIX = 'suffix'
    INFIX = 'infix'
    PREP = 'prep'
    ADV = 'adv'
    ARTICLE = 'article'
    PREP_PHRASE = 'prep_phrase'
    CONTRACTION = 'contraction'
    INTJ = 'intj'
    NAME = 'name'
    PRON = 'pron'
    POSTP = 'postp'
    ADJ = 'adj'
    CIRCUMFIX = 'circumfix'
    NUM = 'num'
    VERB = 'verb'
    PROVERB = 'proverb'
    CONJ = 'conj'
    AFFIX = 'affix'
    NOUN = 'noun'
    PUNCT = 'punct'
    SYMBOL = 'symbol'
    PREFIX = 'prefix'
    CHARACTER = 'character'
    PARTICLE = 'particle'
    DET = 'det'
    INTERFIX = 'interfix'


class WinkPosTag(str, enum.Enum):
    ADJ = 'ADJ'
    ADP = 'ADP'
    ADV = 'ADV'
    AUX = 'AUX'
    CCONJ = 'CCONJ'
    DET = 'DET'
    INTJ = 'INTJ'
    NOUN = 'NOUN'
    NUM = 'NUM'
    PART = 'PART'
    PRON = 'PRON'
    PROPN = 'PROPN'
    PUNCT = 'PUNCT'
    SCONJ = 'SCONJ'
    SYM = 'SYM'
    VERB = 'VERB'
    X = 'X'
    SPACE = 'SPACE'


class Dictionary(Base):
    __tablename__ = 'dictionary'
    __table_args__ = (
        CheckConstraint('word = lower(word)', name='lowercase_word'),
        PrimaryKeyConstraint('word', name='dictionary_pkey'),
        Index('idx_word', 'word'),
        {'schema': 'dictionary'}
    )

    word: Mapped[str] = mapped_column(Text, primary_key=True)
    lexical_entries: Mapped[dict] = mapped_column(JSONB, nullable=False)
    all_links: Mapped[Optional[dict]] = mapped_column(JSONB, Computed("flatten_lexical_blob_mapped(lexical_entries, ARRAY['antonyms'::text, 'synonyms'::text, 'hypernyms'::text, 'hyponyms'::text, 'holonyms'::text, 'meronyms'::text, 'derived'::text, 'related'::text, 'coordinate_terms'::text, 'glosses'::text, 'examples'::text, 'categories'::text])", persisted=True))


class DictionaryRaw(Base):
    __tablename__ = 'dictionary_raw'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='dictionary_raw_pkey'),
        {'schema': 'dictionary'}
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True, start=1, increment=1, minvalue=1, maxvalue=2147483647, cycle=False, cache=1), primary_key=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False)


class DummyTable(Base):
    __tablename__ = 'dummy_table'
    __table_args__ = (
        PrimaryKeyConstraint('selectable_lexical_keys_dummy', 'wiktionary_pos_tags_dummy', 'wink_pos_tags_dummy', name='dummy_table_pkey'),
        {'schema': 'dictionary'}
    )

    selectable_lexical_keys_dummy: Mapped[SelectableLexicalKey] = mapped_column(Enum(SelectableLexicalKey, values_callable=lambda cls: [member.value for member in cls], name='selectable_lexical_key', schema='dictionary'), primary_key=True)
    wiktionary_pos_tags_dummy: Mapped[WiktionaryPosTag] = mapped_column(Enum(WiktionaryPosTag, values_callable=lambda cls: [member.value for member in cls], name='wiktionary_pos_tag', schema='dictionary'), primary_key=True)
    wink_pos_tags_dummy: Mapped[WinkPosTag] = mapped_column(Enum(WinkPosTag, values_callable=lambda cls: [member.value for member in cls], name='wink_pos_tag', schema='dictionary'), primary_key=True)


class Words(Base):
    __tablename__ = 'words'
    __table_args__ = (
        CheckConstraint('word = lower(word)', name='lowercase_word'),
        PrimaryKeyConstraint('word', name='words_pkey'),
        {'schema': 'dictionary'}
    )

    word: Mapped[str] = mapped_column(Text, primary_key=True)
